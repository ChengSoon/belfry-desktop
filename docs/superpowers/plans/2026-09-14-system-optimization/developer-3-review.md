# 开发3交叉审查

任务：`9tjhehn9`；日期：2026-09-15；分支：`feat/multi-agent-collab`，HEAD `439302a` 加当前共享工作区修改。

审查完成：开发3结果文档的面板恢复策略、生产浏览器回归与 CI 接线和当前源码一致。
开发1用量实现发现 **1 项 P2 并发问题**，见 R1；其余重点路径未发现可以确定的新增问题。
本轮只写本报告，未修改产品、测试、CI 或其他交付文档，未运行构建或测试。使用 `belfry` 技能交付。

## R1 — P2：最后一个消费者取消时，新消费者可能加入已经取消的任务

**位置与根因：** `src-tauri/src/usage/analytics/registry.rs:61` 选择可共享 Job，下一行才 `attach()`；
`registry.rs:89` 移除 subscriber 后释放 Registry 锁，在 `registry.rs:93` 才调用 `job.release()`。
`src-tauri/src/usage/analytics/jobs.rs:63` 的计数减至零会永久设置取消标记，而 `jobs.rs:69` 的 `pending()`
与 `jobs.rs:58` 的 `attach()` 没有共同保护该决定。Ticket 丢弃路径 `registry.rs:129` 同样在锁外 release。

**触发条件：** 尚未完成的同一查询只有消费者 A；A 取消或请求被丢弃，与不同 request ID 的消费者 B 注册并发。
例如快速关闭重开用量面板，或加载期间刷新同一筛选。下列交错不违反任何现有锁或原子操作约束：

1. A 在 Registry 锁内移除旧 subscriber，释放锁，尚未执行 `job.release()`。
2. B 取得 Registry 锁；`registry.rs:138` 调用 `pending()`，已观察 `cancel=false`、结果未完成，选择复用旧 Job；尚未 attach。
3. A 在 Registry 锁外将消费者计数从 1 减至 0，设置旧 Job 的取消标记。
4. B 执行 attach，将计数从 0 加至 1，返回 `leader=false` 的 ticket；取消标记不会清除，也不会启动新 worker。
5. 旧 worker 在下一取消检查退出；B 虽然没有被取消，也会收到“用量查询已取消”。

**影响：** 新查询错误失败，用户需要再次刷新。`src/usage/insights/requests.ts:29` 会将错误显示在当前请求，
前端版本隔离不能屏蔽这种“错误已经属于新 request ID”的情况。该问题不是数据静默丢失或两个既有消费者之间的一般取消隔离失败。

**修复建议：** 把任务是否可加入、消费者计数增加、最后消费者离开后的取消决定放在同一同步边界内；
可在 Registry 锁内完成状态转换，把 waker 唤醒留在锁外。只对计数使用原子操作或再次创建前端 request ID 不能修复这段交接。

**验证建议：** 新增确定性线程交错测试，用 barrier/测试钩子暂停在“B 复用判断成功、尚未 attach”，
让 A 完成最后一次 release，再允许 B 继续。断言 B 要么加入仍有效的 Job，要么成为新 Job 的 leader，不能绑定已取消的 Job；
同时覆盖显式 cancel 与 Ticket drop 两种路径，并验证 B 最终取得完整报告。
保留 `src-tauri/src/usage/analytics/state_tests.rs:60` 的两个消费者取消隔离，
以及 `src-tauri/src/usage/analytics/registry_tests.rs:72` 的旧 worker 完成不删除替代任务回归。
现有后者按“cancel 完成 → begin 新查询”顺序执行，没有覆盖本交错。

证据等级：源码锁范围与原子操作顺序推导，未运行并发复现测试。建议由开发1修复并补测试后执行：

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::registry::tests --offline --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib usage::analytics::state::tests --offline --locked
pnpm exec vitest run src/usage/insights/requests.test.ts src/usage/insights/api.test.ts
```

## 开发3结果文档与最终代码核对

核对对象为 `developer-3-result.md` 的面板、生产回归、CI 与相应 README 命令；未改写历史结果。

| 文档描述 | 当前源码依据 | 结论 |
| --- | --- | --- |
| 六个可选面板按打开状态加载，局部 Suspense/错误边界 | `src/components/AppOverlays.tsx:21`、`:76`、`:129`；`src/components/lazy/OptionalPanel.tsx:13` | 一致 |
| JS 入口换 URL 的局部重试；再次失败停止，关闭重开不重置 | `src/components/lazy/panelImport.ts:8`、`:13`、`:26`；`src/components/lazy/retryImport.ts:29` | 一致；失败状态保留在面板工厂闭包内 |
| CSS 单独补载并等待；不可恢复时给出保存终端工作/手动重开提示与返回入口 | `src/components/lazy/panelImport.ts:16`；`src/components/lazy/retryImport.ts:40`；`src/components/lazy/PanelLoadFallback.tsx:68` | 一致；没有自动刷新动作 |
| 生产测试服务完整 dist，真实 HTTP 503，不运行 Vite dev server | `src/components/lazy/testing/productionFixture.mjs:12`、`:37`、`:77` | 一致；缺少 dist 直接失败 |
| 4 项生产测试覆盖入口 JS、首个异步 CSS、重复 CSS 失败、DatePicker 共享依赖失败 | `src/components/lazy/testing/production-panels.case.mjs:13`、`:42`、`:70` | 一致；检查原终端节点/会话保留，共享依赖用独立新文档验证恢复 |
| macOS/Windows 在构建后必跑生产集合，拒绝缺浏览器或跳过项 | `.github/workflows/checks.yml:23`、`:42`、`:52`；`.github/workflows/verify-plugins.mjs:13`、`:22`、`:35` | 一致；本地前置命令见 `README.md:177`、`README.en.md:173` |
| Release 等待检查，先草稿，按序上传，再统一验证并公开 | `.github/workflows/release.yml:16`、`:19`、`:61`、`:101` | 一致；公开前调用完整性校验 |

结果文档中的测试数量、chunk 大小、耗时和 `/tmp` 日志是此前交付证据；本轮只核对实现与测试接线，
未重新运行这些命令，也未将历史通过数称为本轮验证结果。

## 开发1重点审查覆盖

除 R1 外，下列实现和既有测试中未发现可以确定的新增问题：

- **缓存与失效：** `analytics/cache.rs`、`stamp.rs`、`snapshot.rs`、`sources.rs`、`service.rs`。
  核对 Agent/路径组合键、文件身份与时间戳、追加前边界校验、固定 EOF、截断/替换/删除/不可读、LRU、暂存后提交；
  对照 `cache_tests.rs:106`、`:149`、`:171`、`:227` 与 `stream_tests.rs:117`。
- **流式回退与末行：** `analytics/reader.rs`、`records.rs`、`snapshot.rs`。
  索引超预算释放后沿用同一文件句柄与 EOF，Codex 先识别前八行 metadata；流式读取失败不返回部分累计结果。
  核对完整无换行记录、半行追加重解析、超大行丢弃、UTF-8 跨块与读取中的取消；
  对照 `reader_tests.rs:12`、`:40`、`:76`、`:109` 和 `stream_tests.rs:14`、`:43`、`:83`。
- **预算：** `analytics/replay.rs`、`memory.rs`、`aggregate.rs` 与 `usage/codex_memory.rs`。
  核对重复记录不按累计处理量收费、实际保留的去重键/指纹/上下文/桶容量计量、最终 pending flush 后检查、超限显式错误；
  对照 `budget_tests.rs:16`、`:39`、`:74`、`:91`、`:118`。
- **统计兼容：** `usage/claude.rs`、`claude_record.rs`、`codex.rs`、`codex_record.rs` 及相关扫描/pending 模块；
  核对 Claude 全局消息去重、Codex resume、累计基线与最后一次流式修正、窗口/项目过滤、未知日期、额度及预筛规则。
  已对照提取前的 Git 差异与 `semantics_tests.rs`、`stream_semantics_tests.rs`。
- **取消与前端：** `analytics/state.rs`、`jobs.rs`、`registry.rs`、`cancel.rs`、`commands.rs`；
  `src/usage/insights/` 的 API、请求状态机、Hook、诊断字段/提示和统计 model。
  核对独立 request ID、早到/迟到取消、消费者/任务上限、等待缓存锁时取消、版本隔离与卸载取消；R1 是此处尚缺的交接覆盖。

以上 `analytics/` 和未写完整前缀的测试路径均位于 `src-tauri/src/usage/analytics/`。

## 盲区与交接

- 本轮为静态交叉审查，未运行 Rust、Vitest、浏览器测试、性能基准或构建；全量回归由项目经理统一执行。
  没有验证原生 Tauri 窗口、真实 WebView 资源失败、Windows 文件 ID/并发文件替换或远程 workflow。
- 缓存按 CLI 追加写模型工作；同 identity、长度增长且首尾不变的中部改写不保证被发现。
  这是开发1结果文档已声明的边界，本报告未将其重复列为新增缺陷；内存预算也是保留状态估算，不能等同进程 RSS 硬上限。
- `analytics/legacy.rs:26`、`:31`、`:36` 与新路径共用部分解析/聚合代码，比较结果不是完全独立的兼容性证明；
  已结合提取前差异审查，真实日志及平台行为仍应通过项目经理的最终回归确认。
- R1 交开发1处理。报告完成不代表该缺陷已修复；本轮没有修改开发1文件或添加测试钩子。
