# CM-02 历史全文检索 Implementation Plan

> **For agentic workers:** 使用 `superpowers:executing-plans` 按步骤执行。

**Goal:** 完成 CM-02 的正文搜索、命中片段、来源/项目/日期筛选、收藏与标签，保留恢复/删除能力。

**Architecture:** Rust 从原生 JSONL 建立按文件指纹失效的内存搜索缓存，只向界面返回元数据与命中片段。
React 使用防抖请求与过期响应隔离；收藏/标签写入独立 Belfry 存储，和可重建的索引分离。
界面保持现有右侧历史面板，在列表上方增加紧凑搜索与组合筛选，列表提供收藏和标签编辑。

**Tech Stack:** 现有 Rust/serde_json、Tauri 2、React/TypeScript、Vitest；不增加依赖。

**Spec:** [CM-02 范围与验收](../../cli-manager-feature-backlog.md)。

## Global Constraints

- 不修改、截断或重写原始 CLI 日志；读取失败必须可见，不把失败静默显示为无结果。
- 搜索覆盖标题、用户/助手消息与可用工具文本，不把图片 base64 当可搜索内容。
- 按 `agent + 原生 session ID` 关联结果和收藏；Codex resume 分片合并，恢复 ID 不变。
- 日期采用用户本地日历日，开始包含、结束为次日零点不包含，项目使用精确规范化路径匹配。
- 输入法组合期间不触发搜索；请求防抖、旧结果丢弃、扫描可取消，缓存内存有界。
- 新文件不超过 300 行，新增函数不超过 50 行；拆分原历史面板以保持职责清楚。
- 本轮实施授权覆盖 CM-02 所需的私有查询契约和收藏/标签存储，不改变 Agent 共享身份协议。

## Task 1: JSONL 搜索与增量缓存

**Files:** 新增 `src-tauri/src/history/search/` 的 `contracts.rs`、`text.rs`、`query.rs`、`cache.rs`、`mod.rs` 及对应测试；接入 `history/commands.rs`、`history/mod.rs`、`lib.rs`。

**Interfaces:** `HistoryQuery { agent, text, projectRoot, from, until }`；返回 `HistorySearchReport { hits, projects, scannedFiles, skippedFiles }`，每个 hit 包含原 `HistorySession` 和 snippet。

- [x] 写真实 JSONL 用例：Codex response_item / event_msg、Claude 字符串和数组正文、工具参数与输出、图片排除、损坏行后继续。
- [x] 确认正文搜索用例先失败，再实现流式提取；超长行有边界和跳过计数。
- [x] 写缓存/查询用例：续写与替换失效、同 ID 分片合并、Agent 同名 ID 隔离、中文和路径、组合筛选和时间边界、扫描取消。
- [x] 实现文件长度/mtime 指纹缓存，查询期间逐文件检查取消；缓存超出预算时淘汰可重建项。
- [x] 后台阻塞线程执行查询，Tauri 返回错误和跳过信息，不阻塞终端交互。
- [x] 运行 `cargo test history:: --lib`，核对恢复元数据和原文件内容不变。

测试的独立期望示例：

```rust
// fixture 标题为“开始开发”，后面的助手正文包含路径。
let report = index.search(query("src/接口.rs"), &roots, &cancel).unwrap();
assert_eq!(1, report.hits.len());
assert_eq!("session-a", report.hits[0].session.id);
assert!(report.hits[0].snippet.as_deref().unwrap().contains("src/接口.rs"));
```

## Task 2: 收藏、标签与查询状态

**Files:** `src/history/search.ts`、`metadata.ts`、`useHistoryMetadata.ts`、`useHistory.ts` 及测试；保留现有历史身份类型。

**Interfaces:** 收藏以 `JSON.stringify([agent, id])` 为键，值为 `{ favorite, tags }`；查询输入转换为后端时间范围，空筛选传 null。

- [x] 先验证 Codex/Claude 相同 ID 的收藏互不影响，重载保留，坏存档不被覆盖。
- [x] 实现标签整理、按项目/日期/收藏/标签组合筛选及可见错误反馈。
- [x] 测试日期的本地日历边界、无效日期与反向范围；避免 UTC 日期输入偏移。
- [x] 实现搜索防抖和过期响应隔离，按请求 ID 取消；删除后仅在面板仍挂载时刷新，按 Agent 身份逐项删除。
- [x] 运行 `pnpm test src/history`，确认过滤不会更改原 sessionRef。

## Task 3: 历史面板与验收

**Files:** 拆分 `src/history/components/HistoryPanel.tsx` 为搜索栏、列表行、标签编辑、多选/删除确认小组件；扩展历史 CSS。

- [x] 用真实组件渲染测试覆盖搜索入口、片段和标签，避免只检查源码字符串。
- [x] 增加搜索输入、来源/项目/日期选择、收藏/标签过滤；窄面板中仍保持可用。
- [x] 增加行内收藏、标签编辑与命中高亮；保留继续会话、单项删除和多选操作。
- [x] 先显示一页结果，允许加载更多，避免大量会话一次挂载卡住界面。
- [x] 审查搜索取消、持久化失败、跨来源 ID、列表选择和破坏性操作边界。
- [x] 完整执行 `pnpm test`、`pnpm build`、`cargo test`，检查本次差异和格式。
- [x] 使用独立身份的桌面验证构建，操作搜索/组合筛选/收藏/标签/重开，检查窄面板与亮暗主题。
- [x] 核对 CM-02 每条验收后，将小清新待办中的 `CM-02` 标记完成并回读；同步总实施记录。

## 验证记录（2026-09-11）

- 全量前端：84 个测试文件、562 项通过；Rust：361 项单元测试及 1 项集成测试通过，4 项既有忽略。
- 日志：`/tmp/belfry-cm02-final-frontend.log`、`/tmp/belfry-cm02-final-rust.log`。
- 独立桌面构建成功：`/tmp/belfry-cm02-desktop-build.log`，应用标识 `io.appmakes.belfry.feature-qa`。
- 已实际核对：239 个本地日志的检索、Codex/项目/日期/收藏/标签组合、日期反向范围错误、标签去重、320px 窄栏与亮暗主题。
- 自审修正：取消按请求 ID 隔离；元数据与正文均使用可取消的有界行读取；同长度替换、缓存淘汰重建及超长行继续读取均有回归用例。
- 最终独立构建成功：`/tmp/belfry-cm02-desktop-final.log`；重启后重新建立索引，收藏仍为 1 条，两个验收标签保留。
- 小清新待办已勾选 CM-02，关闭再打开后回读确认：剩余 15 项，共 16 项；CM-02 显示于已完成列表。
