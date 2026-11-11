# 精简读模型与首版接口

按用户 `hw6z4w1y`：**人类只看有哪些会话、各自的消息和必要状态；合并、调度、发送由 Agent 与后台处理。** 本页接口是 T60 建议，当前生产尚未提供；未来用 `collaboration-inbox-v1` 能力标记协商，不能在缺字段时猜成新协议。

## 人类界面：会话列表 → 消息详情

列表每个稳定会话一行，显示名称、简短状态、最后一条消息摘要；有积压才补“3 条等待投递”或“1 个问题待回复”。点击一行看按时间排列的原文与回复事实。窄窗用返回会话列表即可，不增加议题总览、处理记录等独立视图。

收件箱不提供合并预览、手动发送、优先级、暂缓、撤回、逐题作答或批次管理操作。用户可以阅读原文、继续翻页、打开现有会话；改变工作方向仍在既有会话/房间交互中完成。批次、租约、hash 和完整调度计数留给 Agent/运行时及诊断数据，不进入默认产品流程。

| 只读接口 | 返回内容 |
| --- | --- |
| `collab_inbox_sessions({projectRoot, roomId?})` | schemaVersion、revision、generatedAt、sessions[]、loadError。只汇总当前范围；包含活会话及仍有未结消息的离线会话，不能因名册暂缺而丢掉积压。 |
| `collab_inbox_messages({sessionKey, roomId?, cursor?, limit?})` | revision、messages[]、nextCursor、loadError。原文和问题/回复事实分页，必要时可按稳定消息 ID 定位窗口外原文。 |

两接口无副作用，不 claim、不确认处理、不触发发送。切换会话/翻页沿用现有请求代次和迟到响应保护；读取失败保留旧结果并显示错误，不能伪装成“没有消息”。

### 会话行字段

| 字段 | UI 对照与口径 |
| --- | --- |
| `sessionKey, tabId, name, agent` | 会话行的 key、定位、名称和辅助类型；sessionKey 对应 `(projectRoot, tabId)`。同为 codex 的两个 tab 是两行，改名不换行。agent 不参与分组。 |
| `runtimeAvailability` | `ready/busy/needs_input/offline/unavailable`，只描述当前输入能力，不表示工作完成。 |
| `summaryStatus` | `{code, params}`，后台按当前事实生成一句话；前端 i18n 渲染。只能共同概括时才用单一阻塞原因，混合情况显示“部分消息等待投递”，具体原因在消息上。 |
| `pendingCount` | 尚未入批、等待自动投递的收件项数；人类列表不把仅知会记录算作等待自动发送。prepared/submitting 用“正在投递”解释，uncertain 单独提示待核对。计数不是待答问题数。 |
| `awaitingReplyCount` | 已有 submitted 证据且仍 open 的问题义务数。尚未投递/不确定的问题仍保留在详情，但不计成“已投递待回复”。 |
| `lastMessagePreview, lastMessageAt` | 当前范围最近原文摘要和时间；摘要用于阅读，不参与归组或覆盖原文。 |
| `oldestPendingAt` | 可选次要信息，表示当前自动待发项的最早等待起点；没有为 null，不用新来信时间重置它。 |

只有这组简短投影用于默认列表。内部 readyCount、inFlightCount、openQuestionCount、activeTaskRefs、waitingOnQuestionIds、blockers 和批次记录不要求在页面逐项展示。

### 消息详情字段

| 字段 | UI 对照 |
| --- | --- |
| `id, by, createdAt, text, attachments` | 发言人、时间、完整原文、既有附件入口。姓名是显示，身份仍固定。 |
| `source, recipient` | 保留 roomId/memberId/tabId；多来源或成员变化时给一句来源说明，不让同名替补继承旧状态。 |
| `replyTo, questions[], replies[]` | 原文引用及逐问题的 open/replied/cancelled、答案链接；一条回答只标出它明确回答的问题。人类只看，不在收件箱勾选或填写答复。 |
| `deliveryStatus, handlingStatus` | 后台投影为稳定 code/params。送达、处理中、已回复分别有事实依据；页面用必要的短标签即可，不展示完整状态机。 |
| `waitingReason?` | 仅对需要解释的消息显示原因；同一会话里回复可投、新任务仍等待时分别解释。 |

仅知会显示“仅知会，已记录”；已投递但没有处理回执显示“已提交到终端，处理情况未知”；撤回显示“待发消息已撤回”。不能因为没有剩余待发就把这些消息统一标成“已处理”。

### 具体文案

| 事实/原因 | 人类看到的文字 |
| --- | --- |
| turn_busy | 等待成员结束当前轮次 |
| previous_task | 等待上一任务完成 · {task} |
| room_paused / topic_held | 投递已暂停，消息已保存 / 这条消息已暂缓 |
| target_offline / target_changed | 等待成员上线 / 接收成员已变化，消息仍保留 |
| awaiting_input / composer_not_empty | 等待成员完成当前选择 / 终端有未提交输入 |
| source_sync_pending / runtime_not_ready | 消息已保存，等待排队 / 等待终端就绪 |
| task_dependency / approval_required | 等待前置任务完成 / 等待批准 |
| queue_turn / collecting | 消息已收集，等待自动投递 |
| prepared / submitting | 正在投递消息 |
| submitted 且有 open 义务 | 已投递待回复 |
| uncertain 或前序 uncertain | 提交结果待核对，后续投递已暂停 |
| reference 已提交 | 已投递原文入口，等待成员读取处理 |
| handling=processing / processed | 成员已确认处理 / 成员已报告处理完成 |
| obligation=replied / cancelled | 此问题已回复 / 此问题已取消 |
| abandoned | 已放弃此次不确定投递；此前是否写入仍未知 |

uncertain 在这里仅提供“查看目标会话”的定位；核对继续复用既有受控入口，不新增批次操作台，也没有重新发送按钮。多个原因并存时优先说明不确定提交/身份问题、暂停、工作约束、输入约束；不能遮掉已投递待回复的事实。普通无积压状态可写“暂无待投递消息”，不推断“全部工作完成”。

精简返回示例（仅为示例标识和节选字段）：

```json
{
  "revision": 42,
  "sessions": [{
    "sessionKey": "session-b",
    "tabId": "tab-b",
    "name": "后端",
    "agent": "codex",
    "runtimeAvailability": "busy",
    "summaryStatus": { "code": "turn_busy", "params": {} },
    "pendingCount": 3,
    "awaitingReplyCount": 1,
    "lastMessagePreview": "补充约束：保留已有字段名。"
  }]
}
```

显示“后端 · 等待成员结束当前轮次”，次要文字“3 条等待投递 · 1 个问题待回复”。详情仍逐条解释，未投递的问题不会冒充已送达待回复。

## Agent 与运行时接口

人类的两类只读接口之外，Agent 才需要完整收件项、议题和问题关系。所有写操作带 operationId，按调用者/命令/参数摘要幂等；同 ID 不同参数拒绝。权限沿用当前成员/任务规则，不因能读收件箱就能修改其他人的工作。

完整 Agent 读模型补充以下调度字段，默认人类界面不展示或编辑它们：

| 内部字段 | 首版约定 |
| --- | --- |
| `deliveryGate` | `{scope:"session", blocked, reason, blockingBatchId}`；存在 uncertain 时 reason=uncertain，阻塞同一 `(projectRoot, tabId)` 跨房间的全部后续自动投递，包含新任务、协商和等待答复。不停止新消息持久化、只读查看或其他会话投递。核对解除后仍须检查安全输入及任务占位，不自动补贴原批次。 |
| `batchLimits` | `{maxSourceScopes:1, maxTopics:1, maxRecipients:1, maxMessages:20, maxPayloadBytes:32768, maxExpandedQuestions:32, maxTaskAssignments:1}`；sourceScope 指房间/普通任务来源范围，不是单条 sourceEventId。任一上限到达即截止，任务分派单独成批，超长单条走原文引用。这是首版建议值，不采用种子演示中的“3 议题/8 条”。 |

`answers` 是 questionId 数组，`replyTo` 仍是单个原文引用。一次答复涉及同来源/同议题的多个提问方时，可保留一个 replyMessageId，将各提问方列入 to，再分别建立投递记录；发给用户的仍走既有用户通知。跨议题答复分开提交，不能为按提问方回流而重复关闭义务或复制成无关联的多条原文。

| 使用方 | 建议接口与约束 |
| --- | --- |
| 发信/答复 Agent | 沿用 room_say/room_task/普通 send 的来源操作，增加 topicId、class、questions、replyTo、answers、correctionOf；回复只更新指定 questionId 对应本人的义务，返回 replyMessageId 和提问者的待投递状态。 |
| 协作 Agent | `collab_inbox_agent_get` 分页返回完整 entries、questions、topicPolicy、activeTaskRefs、waitingOnQuestionIds、blockers；候选带 asOfRevision，不 claim。 |
| 有权 Agent | `collab_inbox_update_topic` 带 expectedPolicyRevision 调整 priority/hold/resume，返回实际影响的 pending 数和未改变的批次；`collab_inbox_withdraw` 带显式 entryIds+逐项 revision，全体仍 pending 才成功。不能把新来的消息隐式包含进旧撤回指令。 |
| 接收 Agent | `collab_inbox_ack` 指定 entryIds、revision、processing/processed；`collab_inbox_wait` 指定本人的 taskRef?、questionIds、set/clear，不阻塞进程。不能因收到一批就确认整个议题。 |
| 有权 Agent | `collab_inbox_close_topic` 以 topicRevision 和结论明确结束；仅在无待发/在途/不确定项和 open 义务时允许，不替任务交差。首版也可仅保留明确结论消息，不必增加人类“结束议题”流程。 |
| Agent 原文读取 | `collab_inbox_read` 用 messageId/游标/maxBytes 取原文字节页、hash、问题页入口，处理超长引用和窗口外原文；读取本身不 ack。 |
| 输入运行时 | `collab_inbox_prepare` 带绑定的 ownerId/targetEpoch/offerId；后台选中并持久化精确 IDs、payload/hash、attemptId、lease；同 operationId 重试返回原批，不另取。 |
| 输入运行时 | `collab_inbox_begin_submit` 带 batchId、attemptId、lease、expectedRevision 和当前 offer；提交意图落盘后才获一次写入许可。运行时自行防重，查询/重试不能再次 sendText。 |
| 输入运行时 | `collab_inbox_receipt` 带 batchId/attemptId/sequence/phase/payloadHash；只补回执。`collab_inbox_abort_prepared` 仅中止无意图批次；`collab_inbox_batch_get` 只查原批。 |
| 既有核对入口 | `collab_inbox_resolve` 以原 batchId/attemptId/sequence/revision 确认 submitted 或 abandon。uncertain 不自动重发；迟到事实和人工决定按协议保留。 |

跨存储副作用按 [持久化边界](dispatch-protocol.md#持久化边界) 补投影，不能凭调用发出就声称已回复/已取消。建议 CLI 增加收件箱读取、处理、等待及 topic/question/answers 参数；拼写需与协议能力和注入提示一起实现，当前 --reply 按 [兼容规则](message-model.md#兼容和保留) 保留旧语义。

## T61 对照

T61 默认页面只需接上面两类只读投影，可以用自己的演示适配层；验收聚焦会话切换、消息阅读、必要筛选和窄窗可达性。相同模型会话、部分答复和离线等状态用示例消息表达；协议边界另由设计场景说明，不要求 T61 增加批次或场景控制面板。

后台的归组/冻结/部分答复可以通过消息和状态变化被观察，不需要人类参与每一批。打开会话或原文也不能因此触发合批、发送或处理确认。
