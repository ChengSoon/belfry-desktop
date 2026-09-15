开发1交付：R1 最后消费者取消与新请求交接竞态

任务：`x729hvmf`。日期：2026-09-15。来源：`developer-3-review.md` 的 R1。
状态：已补稳定复现测试、完成最小同步修复及定向验证。使用技能：`belfry`。
在当前共享分支执行，未提交或推送。

**修复结果**

新请求不再复用已经被最后一个消费者取消的 Job。
`pending()` 判断、`attach()`、消费者移除、计数递减与最后取消决定现在共用 Registry 锁；
waker 的取出与唤醒仍在释放 Registry 锁之后执行。

- `src-tauri/src/usage/analytics/registry.rs:143` 新增 `remove_subscriber()`，在同一临界区内
  移除消费者、设置其取消标记并释放 Job 成员资格。显式 cancel 和 Ticket drop 均走此入口。
- `src-tauri/src/usage/analytics/jobs.rs:63` 的 `release()` 只更新成员计数/最后取消状态，
  不再同步唤醒等待者；`registry.rs:98`、第 137 行在锁外调用 `Job::wake()`。
  `src-tauri/src/usage/analytics/jobs.rs:113` 也先释放 completion 锁，再调用 waker。
- 新消费者先取得 Registry 锁时，会先完成 attach，旧消费者离开后 Job 仍有成员；
  最后旧消费者先取得锁时，会先将旧 Job 标为取消，新请求会创建替代 Job。
  不存在“pending 已通过、最后 release 取消、再 attach 到已取消 Job”的交错窗口。
- `finished()` 的 Job 指针校验、取消中的 worker 槽位计数和请求/任务上限保持原有逻辑。
  没有更改查询键、缓存、统计口径或 IPC，前端无需修改。

本轮产品代码只改 `jobs.rs`、`registry.rs`，新增
`src-tauri/src/usage/analytics/registry_handoff_tests.rs`。
Registry 中的交接钩子及其模块全部使用 `#[cfg(test)]`，不进入生产版本。
三个文件分别为 124、208、193 行，均未超过 300 行。

**稳定复现与 red/green**

`src-tauri/src/usage/analytics/registry_handoff_tests.rs:69` 使用每个 Registry 独立的一次性通道钩子，
明确控制两个真实线程的执行次序，不依赖 sleep、随机调度或重复碰撞概率。
5 秒超时仅用于防止测试无限等待。

1. 先让旧消费者在移出 Registry 后、通知前暂停。
2. 新请求进入 `begin()`，在 Job 选择完成、attach 前暂停。
3. 放行旧消费者，使其 cancel 或 Ticket drop 完成，再允许新请求 attach。
   未修复代码会在步骤 3 取消新请求已经选中的 Job；修复后旧 Job 在步骤 1 之前已在锁内取消，
   因而新请求在步骤 2 选到替代任务。
4. 使用真实 `service::refresh()` 扫描两条合成 Claude 记录，走 `Job::complete()` 和 `Ticket::wait()`。
   断言新消费者得到总 Token **210**，且移除 diagnostics 后所有 report 字段与独立正常查询一致；
   最后断言消费者和运行任务计数均清零。

两条独立回归位于该文件第 137、142 行，分别覆盖显式 cancel 和 Ticket drop。
只加测试及测试钩子、尚未修复时，两条均实际失败：

```text
new consumer must receive the complete report, not the old cancellation: "用量查询已取消"
test result: FAILED. 1 passed; 2 failed; 0 ignored
```

这是预期 red，命令退出 **101**；失败原因正是 R1，未以编译失败或超时充当复现证据。
完成同步修复后，原样执行同一命令，**3 通过、0 失败**，退出 **0**。

第三项回归位于 `src-tauri/src/usage/analytics/registry_handoff_tests.rs:165`：
为旧请求注册真实 waker，分别走 cancel/drop；唤醒时先用 `try_lock()` 断言 Registry 锁已释放，
再同步重入 `Registry::begin()` 创建替代请求，断言仅唤醒一次且旧请求返回取消。
这项测试防止把状态转换移入锁内时，连带把通知也移入锁内造成重入死锁；red/green 两阶段均通过。

**实际命令与结果**

以下命令均在 `/Users/cheng/work/Project/tool/otty-win` 执行。

| 阶段 | 实际命令 | 结果与退出码 |
| --- | --- | --- |
| Red：仅新增测试/测试钩子 | `cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::registry::handoff_tests --offline --locked -- --nocapture` | 1 通过、2 失败；101，失败信息如上 |
| Green：同步修复后 | `cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::registry::handoff_tests --offline --locked -- --nocapture` | 3 通过、0 失败；0 |
| Rust 用量回归 | `cargo test --manifest-path src-tauri/Cargo.toml --lib usage:: --offline --locked -- --quiet` | 129 通过、0 失败、5 忽略；0 |
| 前端用量回归 | `pnpm exec vitest run src/usage/insights` | 3 文件、10 项通过；0 |
| Rust 格式检查 | `rustfmt --check --edition 2024 --config skip_children=true src-tauri/src/usage/analytics/jobs.rs src-tauri/src/usage/analytics/registry.rs src-tauri/src/usage/analytics/registry_handoff_tests.rs` | 通过；0 |
| 既有差异空白检查 | `git diff --check -- src-tauri/src/usage src/usage/insights` | 通过；0 |

这些 Rust 文件在共享工作区仍为未跟踪文件，`git diff --check` 不涵盖其内容；
另外实际使用 Python 逐文件检查了三个文件的行尾空白及最终换行，全部通过，退出 0。

本次 usage 回归包含且通过了原有的：

- `src-tauri/src/usage/analytics/state_tests.rs:60`：取消一个消费者后，另一个仍完成真实扫描并取得结果。
- `src-tauri/src/usage/analytics/registry_tests.rs:72`：旧 worker 完成及迟到取消不能移除替代任务。
- `src-tauri/src/usage/analytics/registry_tests.rs:54`：取消中的 worker 仍计入槽位，不能排成无界后台队列。
- `src-tauri/src/usage/analytics/state_tests.rs:78`、第 92 行：缓存锁等待期间取消、future 丢弃清理。

原有测试断言未修改；前端请求替换、取消 IPC 和旧响应隔离测试也未修改，只重新运行验证。

**自查与边界**

- 已核查 Job 成员增减的调用点均在 Registry 临界区内；临界区仅增加取消标记和计数操作，
  没有加入 IO、异步等待或 waker 回调。`Job::complete()` 同样先释放 completion 锁再通知，
  避免与 Registry → completion 的既有查询锁顺序形成反向持锁。
- 构建复用既有 `src-tauri/target/debug`，三次 Cargo 输出均使用既有测试目标
  `belfry_desktop_lib-af773d99e54bc5b5`；未创建独立 target、worktree 或发布构建树。
  `df -h .` 开工可用 2.0 GiB，red/green 后采样为 1.7 GiB；没有删除现有构建产物或其他会话文件。
- 竞态回归控制的是已报告的成员交接时序，使用真实文件扫描验证结果；未运行形式化并发模型检查。
  原有 5 个忽略项在本轮未执行，没有将其计为通过。
- 本轮未运行全仓回归、生产构建、性能基准、原生窗口或 Windows 实机验证；最终整合仍由项目经理执行。
  未修改根入口、CI、依赖、锁文件、终端或其他开发的代码/报告，也没有新增接线要求。

交付回报命令：`belfry done x729hvmf <交付摘要>`。
