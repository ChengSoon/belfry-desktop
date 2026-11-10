# 协作收件箱 · 界面原型（T61）

可点击原型：[prototype/index.html](prototype/index.html)；截图在 [screenshots/](screenshots/)。协议与字段见 T60 的 `README.md`、`message-model.md`、`dispatch-protocol.md`、`api-ui.md`（合并后与本文同目录）。

## 取舍

按用户要求“越简单越好，只看有哪些会话，合并发送交给 Agent”，界面只有两层：

1. **会话列表**：每个稳定会话一行（名称、`Agent · tabId`、一句状态、最后一条摘要），有积压才补“N 条等待投递 / N 个问题待回复”。筛选只有“全部会话 / 有待处理”。
2. **消息详情**：按时间排列的原文；每条消息下面一行状态；带问题的消息逐条列出问题，各自显示“已回复：…/待回复/尚未送达”。右上角“打开会话”切到对应终端。

界面上**没有**投递、合并预览、优先、暂缓、撤回、答复、批次管理等操作，这些都由 Agent 和后台完成。早先按种子原型做的“三视图 + 操作台”版本已按用户反馈撤掉。

## 状态怎么表达

| 场景 | 看到的文字 |
| --- | --- |
| 协商排队，成员正忙 | 等待成员结束当前轮次 |
| 新任务排队，上一任务未交差 | 等待上一任务完成 · T60 … |
| 同一会话两种原因并存 | 会话行写“部分消息等待投递”，详情逐条写各自原因 |
| 已送达，问题未答 | 已投递待回复；问题行“待回复” |
| 一条消息两个问题只答了一个 | 问题 1“已回复：…”，问题 2 仍“待回复” |
| 任务已送达 | 成员已确认处理 · 以交差为准（送达不等于完成） |
| 没有处理回执 | 已提交到终端，处理情况未知 |
| 仅知会 | 仅知会，已记录（不计入等待投递） |
| 提交不确定 / 重启时正在投递 | 提交结果待核对，后续投递已暂停（红色，不自动重投） |
| 离线 / 房间暂停 / 撤回 | 等待成员上线 / 投递已暂停，消息已保存 / 待发消息已撤回 |

颜色：琥珀=还在等，蓝=等对方回复，红=要人核对，绿=已完成，灰=无需关注。文案取自 `api-ui.md`“具体文案”表。

## 字段对照

会话行用 `collab_inbox_sessions` 的 `sessionKey/tabId/name/agent/runtimeAvailability/summaryStatus/pendingCount/awaitingReplyCount/lastMessagePreview/lastMessageAt`；详情用 `collab_inbox_messages` 的 `by/createdAt/text/replyTo/questions[]/deliveryStatus/handlingStatus/waitingReason`。

两点口径：同为 Codex 的多个会话按 `tabId` 各占一行；`pendingCount` 不含仅知会，`awaitingReplyCount` 只统计已送达仍未答的问题。

## 验证

`node prototype/tools/verify.mjs` 用本机无头 Chrome 跑真实点击，共 14 项，全部通过。覆盖：主界面无操作按钮、同类模型分行、会话状态与计数、逐问题状态、各类文案、筛选、深浅主题，以及用 `#demo` 模拟的后台事件（协商先于新任务送达、交差后才送任务、部分回复、提交不确定、重启、离线、暂停）。720×480 下可以从列表进详情再返回，Esc 也能返回，没有横向溢出。

截图：`1440-sessions`、`1440-detail`、`1440-detail-light`、`1440-demo-after-turn`、`720-sessions`、`720-detail`、`720-sessions-light`。

## 未覆盖

没有接后端，没有在 Windows/WebView2 里验证，也没有做英文文案。状态文案进入生产时走 `t()`。
