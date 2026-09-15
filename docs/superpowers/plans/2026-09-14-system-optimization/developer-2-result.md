# 开发2：终端优化结果

状态：实现、定向验证与自查完成。任务 `md22evwe`。
本次使用 `belfry` 技能；按现有任务包执行，未提交、推送或修改其他开发的文件。

## 执行进度

- [x] 完整阅读总计划和开发2任务包，核对现有终端/daemon 生命周期。
- [x] 提前写出根入口接线约定 `developer-2-integration.md`。
- [x] 实现有界输出批次、消费确认、连接替换与取消清理。
- [x] 将控制器拆为生命周期、输入、输出、渲染和布局模块。
- [x] 完成慢消费、身份隔离、断线、dispose、真实解析器压力与原有回归。
- [x] 完成生产构建、自查、结果记录。

## 具体改动

- `daemon/output_budget.rs`：每连接的字节/批次预算、严格顺序确认、30 秒确认超时、
  Condvar 唤醒与取消；额度等待只发生在该连接的轮询线程。
- `daemon/subscription.rs`、`subscriptions.rs`：批次封装、轮询 socket 取消、旧连接替换、
  线程退出时清除自身注册。旧线程不能删除新连接；查找/插入后释放注册表锁再操作连接。
- `terminal/output_commands.rs`、`runtime.rs`、`commands.rs`：`terminal_ack_output` 接到
  既有 runtime；`terminal_create` 通过可选参数协商确认能力；封装后的 exit 仍更新宿主跟踪。
- `daemon/slot.rs`：有数据时直接返回已读取的 Poll 页，消除同一页的第二次复制。
- `src/terminal/controller/`：独立的生命周期、输入/剪贴板/拖放、输出队列、输出解析、
  渲染设置、布局、状态和诊断模块。`terminalController.ts` 从 630 行降到 57 行，
  `mountTerminal`、`TerminalHandle`、诊断函数的外部调用面保持兼容。
  新增的生产控制器文件最长 175 行，新增 Rust 生产文件均小于 300 行。
- `PromptInput.dispose()`：取消解析窗口计时器及等待；迟到的 PTY 写入完成不能再建立计时器或发 Enter。
- 输出序号在入队时同步检查，防止早期协议错误被迟到的创建响应越过并发送启动命令。
  首批输出先于创建响应到达时，也能直接使用批次连接身份 detach。

## 预算与确认协议

- 新前端调用 `terminal_create` 时传 `flowControl: true`。宿主发送：
  `{ kind: "output_batch", sessionId, connectionId, deliveryId, events }`。
  `events` 保持原有事件格式与顺序；未启用确认的旧调用仍收到原事件。
- 在途上限是每连接 **256 KiB 记账量、最多 4 批次**。输出按源字节数加 128 字节/事件记账；
  控制事件另计固定/文本开销。每批最多 256 个事件，通常不超过一个 128 KiB Poll 页的预算。
  宿主允许额外暂存至多一个既有 Poll 页；页上限本来允许最后一个 PTY 事件的越界量。
- 这一预算限制宿主已经发往 WebView、尚未确认消费的数据量及 IPC 批次数，
  **不是整个 WebView/Rust 进程 RSS 上限**。JSON 数组、对象和渲染缓存仍有额外开销。
  前端另限制待处理源数据/事件数，连续输出合并后一次只送一组给 xterm，
  单次重写后的解析输入另有 512 KiB 硬上限。
- 整批输出经过 xterm `write(..., callback)` 的解析完成回调后，前端调用
  `terminal_ack_output({ sessionId, connectionId, deliveryId })`。被主题过滤为空的输出也经过回调；
  暂存的 ANSI 片段由既有主题过滤器保留，长度仍受原限制。
- 只接受当前 session/connection 最早未确认的 delivery；旧连接、重复和乱序确认返回 `false`，
  不归还任何额度。前端顺序发 ACK，解析完成后先释放本地队列占用，允许新批次先于 ACK 响应到达。
- 30 秒未确认转入可重连错误态。dispose、detach、错误、连接替换和退出排空都会清除待确认项并唤醒等待者；
  已建立的轮询 socket 同时 shutdown，初次 TCP connect 仍受原有 2 秒超时约束。
- daemon PTY reader 和原有 **2 MiB 回放缓存**不等待前端。慢消费/关闭 UI 不终止后台进程；
  溢出仍发送 `replay_gap`，前端先排空旧写入，再 reset 并写可见缺口提示。
- daemon `VERSION`、命令和回放游标协议、持久化格式均未改变；批次仅由宿主生成。
  OSC 颜色应答仍在原生 reader，输入走独立写入路径，启动命令仍仅对新进程执行一次。

## 压力证据及无丢失断言的范围

1. Rust 真实轮询/TCP/回放代码配合可重复内存生产者：先保留 256 KiB 初始输出、暂停确认，
   再生产 64 MiB。生产者在前端不归还额度时仍能完成。
   观察在途峰值 **196,992 / 262,144 字节**；输出保留次序正确，报告 **993 个丢弃事件**，
   实际转发保留的 2,293,760 字节并送达最终 exit。最新整合运行用时 1.13 秒。
   这里明确验证缓存溢出后的 gap，不声称 64 MiB 都留在 2 MiB 缓存中。
2. 同一路径的慢消费测试在缓存足够时完整验证 **768 KiB** 的字节内容、顺序和无 gap；
   原有真实 PTY **1 MiB** 有序输出回归也通过。
3. 前端使用实际 `@xterm/xterm` 解析器、未打开窗口，配合预算内宿主模拟器完整解析 **64 MiB**：
   源数据在途峰值 **196,992 字节**、xterm 待解析字节峰值 **65,536 字节**、**1,024 次确认**，
   全部字节经输出解码与解析回调，期间输入通道仍可用。单独采样用时 2,533 ms。
4. 原有真实 PTY 输入回显测试最新 **P95 0.35 ms**，通过本机 macOS 50 ms 门槛；
   原生 OSC 应答、跨块 UTF-8/ANSI、主题过滤、提示词输入及启动一次回归通过。

上述耗时仅记录本机测试路径；不是发布版性能数据，也没有将 debug/release 差异计算为收益。
压力验证仅使用本任务创建的线程、回环 socket、解析器及既有测试创建的 PTY，不操作正式 Belfry 会话。

## 实际验证

| 命令 | 最终结果 |
| --- | --- |
| `pnpm test src/terminal src/prompt src/agent/hooks src/workspace/projects/launch.test.ts` | 26 文件、170 项通过 |
| `pnpm exec vitest run src/terminal/controller/outputPressure.test.ts --silent=false --reporter=verbose` | 真实 xterm 64 MiB 压力通过，输出上述指标 |
| `cargo test --lib terminal:: --offline --locked -- --nocapture`（`src-tauri/`） | 92 项通过、0 失败；含流控、daemon、OSC 和真实 PTY 回归 |
| `pnpm exec tsc -b --pretty false` | 通过 |
| `pnpm build` | 通过；仍有主包超过 500 kB 的构建提示，拆包结果属于开发3/整合范围 |
| 本任务 Rust 文件的 `rustfmt --edition 2024 --config skip_children=true --check` | 通过 |
| `git diff --check` | 通过 |

## 接线与限制

- 项目经理已在当前共享分支的 `src-tauri/src/lib.rs` 注册
  `terminal::output_commands::terminal_ack_output`；开发2未编辑根入口。
- 本任务自查覆盖连接替换/取消的锁顺序、ACK 到达与创建响应竞态、预算边界、退出排空、
  解析回调和输入计时器清理。统一跨开发审查、全仓测试和远程 CI 仍由项目经理收尾。
- Rust 原有 `the_cli_directory_goes_to_the_front_of_path` 测试本机提示
  “belfry 还没构建”后自跳过其 CLI 定位断言；测试计数虽为通过，不据此宣称该断言已验收。
- 本次没有运行 Windows/ConPTY 实机、完整 Tauri WebView 可视交互或远程 PR CI。
  实际解析器压力不等同于 WebGL 绘制帧率或生产 WebView 内存测量。
