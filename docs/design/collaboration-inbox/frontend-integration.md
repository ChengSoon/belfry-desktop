# 协作收件箱 · 前端接入（T63）

基线 `7ddf5e8`。契约以 T62 的 `src-tauri/crates/belfry-protocol/src/inbox.rs` 与 `implementation-contract.md` 为准；前端类型逐字段对应，见 `src/inbox/contracts.ts`。

## 结构

| 文件 | 作用 |
| --- | --- |
| `src/inbox/contracts.ts`、`api.ts` | DTO 与 IPC 客户端（只读两接口、切换、运行时 9 个命令）。 |
| `src/inbox/useInboxDelivery.ts` | 决定唯一投递 owner 并驱动运行时（见下）。 |
| `src/inbox/runtime.ts` | 输入运行时：offer → prepare → begin → 一次写入 → 回执。 |
| `src/inbox/useInbox.ts` | 只读数据：会话列表、消息分页，带请求代次。 |
| `src/inbox/InboxView.tsx`、`status.ts` | 会话协作面板里的“收件箱”页：会话列表 → 消息详情。 |
| `src/terminal/promptInput.ts` 等 | `sendText` 新增 `inboxGuard`、`expectedInputRevision`；`terminal_write` 透传 `inboxGuard`/`writeSequence`；target 暴露 `inputRevision()`。 |

## 投递 owner 切换

1. 启动先调用 `collab_inbox_capabilities`。命令不存在（旧后端）或没有 `collaboration-inbox-v1` → `legacy`，旧 `DeliveryCoordinator` 照旧运行。
2. 支持但未启用 → 此时旧循环从未启动，直接 `collab_inbox_activate`，成功即 `inbox`。
3. 已启用 → `inbox`。
4. activate 失败 → `halted`：两条路径都不自动投递，面板提示“自动投递已暂停，消息仍会保存”，不回退旧路径。
5. 探测完成前两条路径都不运行。

## 运行时规则

- 只轮询 `collab_inbox_pending`（750ms）。每个会话一个标志，不为每条消息 claim，也不进 PromptQueue。
- 就绪条件全部来自真实 target：`running`、`idle`（activity 为 idle）、`composerEmpty`、无选择/权限框（activity 非 awaiting-choice 且 `readInteraction()` 为空）、旧 PromptQueue 对该会话为空。名册 idle 不参与。
- 记录本地 `inputRevision` 与 `terminalSessionId`。offer 后、prepare 后、begin 后各复查一次；在 begin 之前发现变化就 `abort_prepared` + `revoke_offer`，原项回 pending。
- begin 成功后在已保留的位置调用一次 `sendText(payload, { inboxGuard, expectedInputRevision })`。粘贴和回车两次写入都带同一 guard，`writeSequence` 1、2 连续；用户键盘写入不带 guard。
- 写入结果为 submitted → 回执 submitted；其余（被抢先、detached、begin 之后 sendText 被拒）→ 回执 uncertain，绝不重写。回执 `sequence = begin 返回的 batch.sequence + 1`，失败只重试原回执。
- begin 请求本身失败：不写入，不重发本批；下一次重新 prepare，由后台按恢复规则决定（已落意图则 uncertain blocker）。
- uncertain 回执送达之前本地阻塞该会话；送达之后由后台 `deliveryGate`（跨房间、跨窗口）阻塞。界面不提供确认/放弃/重发按钮，核对留给 Agent/后台协议。
- 同一会话同时最多一个在途尝试；`ownerId` 每个运行时实例一个 UUID，换 PTY 或 offer 被拒时重新 bind。

## 只读界面

- 面板顶部“收件箱 / 任务”两页；仅在 `inbox` 模式出现，旧任务视图保留。
- 会话行：名称、`agent · …tabId 末 6 位`（完整 id 在 title）、一句状态、最后摘要、有积压才显示“N 条等待投递 · N 个问题待回复”。多项目逐个查询后按 sessionKey 合并。
- 详情：按时间排列的原文、引用、附件数、逐问题状态（已回复：原文 / 待回复 / 尚未送达 / 已取消）、每条一行状态。送达但无处理回执显示“已提交到终端，处理情况未知”。
- 唯一操作是“打开会话”（切到目标终端）。Esc 或“会话”返回列表并把焦点还给原会话行。
- 读取：列表与消息各有请求代次，切会话、返回列表、翻页后迟到响应丢弃；失败保留上次结果并显示错误；游标原样回传；按收件项 id 去重，旧 revision 不回滚新状态。
- 未知状态码显示“状态已更新”，不暴露原始 code。中英词条在 `src/i18n/locales/*/inbox.json`。

## 验证

- 单测：`src/inbox/*.test.ts`（运行时 17、只读读取 10、状态 7、切换 7）与 `src/terminal/promptInput.test.ts` 的 guard 4 项。全量 193 文件 1219 项通过；`tsc -b`、`pnpm build`、`pnpm check:i18n` 通过。
- 生产浏览器（`src/components/lazy/testing/inbox.case.mjs`，未改写的生产构建 + 按契约模拟的原生 IPC）：
  1. 1440 与 720×480：会话列表、混合原因、计数、详情各类状态、无投递类按钮、Esc 返回且焦点归位、搜索/无结果、720 无横向溢出。
  2. 运行时：Agent 工作中不 offer；prepare 后用户键入 → abort 且零写入；再次就绪后整批一次写入，guard 一致、序号 1、2，回执 `submitted`/3，新任务不随协商送出，没有重复写入，旧 `collab_pending_tasks` 未被调用。
  3. 原生侧先收到用户写入（前端未见）→ begin 被拒，零写入、零回执。
- 截图：`production-screenshots/`（1440 与 720×480 的列表、详情）。

## 未覆盖

- 未接真实 T62 Rust 实现（尚未合入），浏览器中的原生命令为按契约编写的模拟；整合时需在真实后端上复跑 `inbox.case.mjs` 的场景。
- 未在 Windows/WebView2 原生运行。
- 消息“加载更早”只在后端返回 `nextCursor` 时出现，模拟数据未覆盖翻页的视觉，逻辑由单测覆盖。
