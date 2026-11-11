# 协作收件箱 · 前端接入

设计基线 `7ddf5e8`；T63 与 T65 的实现已整合到 `feat/collaboration-inbox-integration`。契约以 `src-tauri/crates/belfry-protocol/src/inbox.rs` 与 `implementation-contract.md` 为准；前端类型逐字段对应，见 `src/inbox/contracts.ts`。

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/inbox/contracts.ts`、`api.ts` | DTO 与 14 个 IPC 客户端；会话和消息两个入口供界面读取。 |
| `src/inbox/useInboxDelivery.ts` | 决定唯一投递 owner 并驱动运行时（见下）。 |
| `src/inbox/runtime.ts` | 输入运行时：offer → prepare → begin → 一次写入 → 回执。 |
| `src/inbox/useInbox.ts` | 只读数据：会话列表、消息分页，带请求代次。 |
| `src/inbox/InboxView.tsx`、`status.ts` | 协作房间中栏“收件箱”页签（`src/rooms/view/RoomView.tsx`）：按房间读取，会话列表 → 消息详情。顶部“会话协作”面板不再显示收件箱。 |
| `src/terminal/promptInput.ts` 等 | `sendText` 新增 `inboxGuard`、`expectedInputRevision`；`terminal_write` 透传 `inboxGuard`/`writeSequence`；target 暴露 `inputRevision()` 和 `canPasteMultiline()`。 |

## 投递 owner 切换

1. 启动先调用 `collab_inbox_capabilities`。仅明确缺少该命令（旧后端）时进入 `legacy`；IO/权限错误、未知协议版本、缺少能力标记均进入 `halted`。
2. 支持但未启用 → 此时旧循环从未启动，直接 `collab_inbox_activate`，成功即 `inbox`。
3. 已启用 → `inbox`。
4. activate 失败 → `halted`：两条路径都不自动投递，面板提示暂停并保留可用的错误原因，不回退旧路径。
5. 探测完成前两条路径都不运行。

## 运行时规则

- 只轮询 `collab_inbox_pending`（750ms）。每个会话一个标志，不为每条消息 claim，也不进 PromptQueue。
- 就绪条件全部来自真实 target：`running`、`idle`（activity 为 idle）、`composerEmpty`、无选择/权限框（activity 非 awaiting-choice 且 `readInteraction()` 为空）、旧 PromptQueue 对该会话为空，以及 xterm 已启用 bracketed paste。名册 idle 不参与。
- 记录本地 `inputRevision` 与 `terminalSessionId`。offer 后、prepare 后、begin 后各复查一次；在 begin 之前发现变化就 `abort_prepared` + `revoke_offer`，原项回 pending。
- begin 成功后在已保留的位置调用一次 `sendText(payload, { inboxGuard, expectedInputRevision })`。粘贴和回车两次写入都带同一 guard，`writeSequence` 1、2 连续；用户键盘写入不带 guard。
- `PromptInput` 先捕获 xterm 的实际编码，核对完整粘贴帧和冻结正文；接受等价换行，内容不符则零写入。原生层还会独立核对分片、序号和完整帧后才允许提交键。
- 写入结果为 submitted → 回执 submitted；其余（被抢先、detached、begin 之后 sendText 被拒）→ 回执 uncertain，绝不重写。回执 `sequence = begin 返回的 batch.sequence + 1`，失败只重试原回执。
- begin 请求本身失败：不写入，不重发本批；下一次重新 prepare，由后台按恢复规则决定（已落意图则 uncertain blocker）。
- uncertain 回执送达之前本地阻塞该会话；送达之后由后台 `deliveryGate`（跨房间、跨窗口）阻塞。界面不提供确认/放弃/重发按钮，核对留给 Agent/后台协议。
- 同一会话同时最多一个在途尝试；`ownerId` 每个运行时实例一个 UUID，换 PTY 或 offer 被拒时重新 bind。

## 只读界面

- 面板顶部“收件箱 / 任务”两页；仅在 `inbox` 模式出现，旧任务视图保留。
- 会话行：名称、`agent · …tabId 末 6 位`（完整 id 在 title）、一句状态、最后摘要、有积压才显示“N 条等待投递 · N 个问题待回复”。多项目逐个查询后按 sessionKey 合并。
- 详情：按时间排列的原文、引用、附件数、逐问题状态（已回复：原文 / 待回复 / 尚未送达 / 已取消）、每条一行状态。引用原文不在本页或来自另一接收会话时使用 `replyPreview`。送达但无处理回执显示“已提交到终端，处理情况未知”。
- 唯一操作是“打开会话”（切到目标终端）。Esc 或“会话”返回列表并把焦点还给原会话行。
- 读取：列表与消息各有请求代次，切会话、返回列表、翻页后迟到响应丢弃；失败保留上次结果并显示错误；游标原样回传；按收件项 id 去重，旧 revision 不回滚新状态。
- revision 变化时刷新已展开历史范围，较早提问也会更新答复状态；一次新增多页消息时补齐中间页，保留原历史游标。移出项目立即清除该项目的选中会话、消息和游标，迟到响应失效。
- 搜索范围是会话名称、Agent 与最新消息摘要，输入提示明确标为“最新消息”。
- 未知状态码显示“状态已更新”，不暴露原始 code。中英词条在 `src/i18n/locales/*/inbox.json`。

## 验证

- 整合后相关前端回归 20 文件、190 项通过；最终兼容判断修正增加 1 项并定向复跑 `useInboxDelivery.test.ts`，10 项通过。类型、生产构建及国际化检查通过。完整命令和范围见[整合验收](../../collaboration-inbox-verification.md)。
- 生产浏览器（`src/components/lazy/testing/inbox.case.mjs`，未改写的生产构建 + 按契约模拟的原生 IPC）：
  1. 顶部“会话协作”面板不显示、也不读取收件箱；运行时照常激活。
  2. 运行时：Agent 工作中不 offer；prepare 后用户键入 → abort 且零写入；再次就绪后整批一次写入，guard 一致、序号 1、2，回执 `submitted`/3，新任务不随协商送出，没有重复写入，旧 `collab_pending_tasks` 未被调用。
  3. 原生侧先收到用户写入（前端未见）→ begin 被拒，零写入、零回执。
  4. 真实 xterm 未启用安全粘贴时不 begin；启用后自动生成 DSR 应答，不误判为用户输入。
- 房间收件箱（`src/components/lazy/testing/rooms-inbox.case.mjs`，房间夹具 + 模拟原生 IPC）：只按本房间读取、角标、逐问题答复与跨会话引用、无投递类按钮、打开会话、只读不触发投递；720×480 列表/详情/返回；英文与 Esc 只返回列表；无收件箱后端时不出现页签。
- 截图位于 `production-screenshots/`：中文 1440 列表与详情、720×480 列表与详情，以及英文 720×480 详情。

## 未覆盖

- 浏览器脚本固定替换原生 IPC，运行它不等于验证实际 Rust 后端。后端已整合，并以临时 RoomStore、实际 InputGate 与真实 macOS PTY 消费者独立验证；本轮未在同一条测试中贯通浏览器到实际 Tauri IPC。
- 未在 Windows/WebView2 原生运行。
- 消息“加载更早”只在后端返回 `nextCursor` 时出现，模拟数据未覆盖翻页的视觉，逻辑由单测覆盖。
