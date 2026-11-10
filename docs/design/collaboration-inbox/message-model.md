# 消息模型与工作状态

本页字段均为建议，时间统一为 Unix 毫秒，revision/sequence 单调递增。显示名称和模型类型不参与身份判断。

## 身份和数据对象

`RecipientRef = { projectRoot, tabId, roomId: string | null, memberId: string | null }`。

`projectRoot` 使用现有项目路径规范化规则。房间消息必须同时固定 roomId/memberId/tabId；普通互派任务的 roomId/memberId 为 null。后台返回不透明 `recipientId` 标识具体收件身份，`sessionKey` 标识会话列表中的 `(projectRoot, tabId)`。**按 `(projectRoot, tabId)` 互斥调度和汇总提醒，按 `(roomId, memberId, tabId)` 保存房间投递与回复事实。** 同一个 tab 加入多个房间也不能同时注入两批。

改名只改显示。离开重入产生的新 memberId、换绑 tab、同名替补不继承旧收件项；旧项显示“接收成员已变化”。终端重建另有 `targetEpoch`，防止旧运行时向新 PTY 写入；它不替代持久 tabId。

`@用户` 仍走既有房间记录与用户通知，不创建 Agent 收件占位，也不等待一个不存在的用户终端。

| 对象 | 必要字段 | 责任 |
| --- | --- | --- |
| Message | `id, sourceRef, topicId, by, to[], createdAt, text, attachments[], class, taskRef?, replyTo?, answers[], correctionOf?, questions[]` | 不可变原文和明确关系。sourceRef 带来源、事件 ID、源 revision；by/to 固定身份并带显示快照。 |
| TopicRecipient | `topicId, recipientId, title, priority, holdUntil, policyRevision, resolvedAt?` | 某成员在某议题中的待发策略。priority=normal/high；holdUntil=null/时间戳/manual。不等同工作状态。 |
| InboxEntry | `id, revision, messageId, recipientId, enqueueSeq, receivedAt, batchId?, deliveryPhase, handling` | 一条原文给一个接收者的投递。唯一键是 `(sourceEventId, recipientId)`；已撤回/已投递也保留去重依据。 |
| Question | `id, messageId, index, text或textRef, recipients[]` | 发信人显式列出的一个问题。稳定 questionId 不依赖文案或数组当前位置。 |
| ReplyObligation | `questionId, recipientId, state, replyMessageIds[], updatedAt` | 每个指定成员各自的 `open / replied / cancelled`；一个人回复不替其他人结项。 |
| DeliveryBatch | `id, recipientId, targetEpoch, topicId, entryIds[], messageIds[], cutoffSeq, payload, payloadHash, contentMode, attemptId, phase, sequence, revision, preparedAt, leaseExpiresAt` | 冻结清单、精确字节及其回执。内容字段永不修改；只有回执状态推进。contentMode=full/reference。 |
| TaskSlot / WaitLink | `taskRef, recipientId` / `taskRef, questionId, waitingRecipientId` | 当前已交给该会话的任务占位，以及明确等待的问题。仅这些门控信息，不建立通用工作流。 |

TaskRef 包含来源及范围，例如 `{kind:"room", roomId, id:"T60"}` 或 `{kind:"direct", id}`，不能仅用 T60。源任务 revision 单独用于拒绝旧事件。

## 消息分类与归组

| Message.class | 产生方式 | 投递规则 |
| --- | --- | --- |
| `task_assignment` | 任务创建/分派的结构化事件，含 taskRef | 安全输入机会 + 当前任务占位已释放 + 原有批准/依赖检查。 |
| `discussion` | 问题、意见、补充、重要修订 | 安全输入机会；不等整个任务结束。关联当前任务也不变成新任务。 |
| `reply` | 显式 replyTo/answers | 匹配接收者 WaitLink 时优先解除等待；仍需安全输入机会。 |
| `fyi` | 发信人明确选择“仅知会” | 记录且可查，单独存在时不唤起一轮；可随同议题其他消息带入，成员也可通过只读接口自行查看。 |

现有 `kind=notice`、`mode=send` 不能直接当成 fyi；任务通知尤其不能靠本地化正文猜分类。任务更新、交差通知也不能冒充下一任务分派。

fyi 不能同时创建要求回复的问题；有回复义务时使用 discussion。已经结项、改派或在同一任务生命周期内已投递的旧分派事件不能再次作为新任务入批。

归组顺序：显式 topicId；否则继承同来源 replyTo/correctionOf 的 topicId；只有 answers 时继承其问题所属的唯一 topicId；新任务使用带范围的 taskRef 议题；均没有则新建议题。answers 必须同范围/同议题。跨房间、跨项目或冲突的 topic/reply 关系拒绝，不能因为标题相似自动归组。一批只包含一个来源、一个议题和同一接收者；议题可同时含不同 class，门控按收件项计算。

补充和修订总是新增消息，保留被修订原文；`correctionOf` 不自动取消旧问题。重要修订由有权操作者显式提高优先级。不同意见并列保留，不自动生成“已达成一致”。

## 投递、处理、回复分别记录

| 维度 | 值与事实来源 | 不能据此推断 |
| --- | --- | --- |
| deliveryPhase | `pending / prepared / submitting / submitted / uncertain / withdrawn / abandoned`；持久化投递协议 | submitted 只表示已提交到目标终端，不证明 Agent 看过或完成。abandoned 表示人工放弃该次不确定投递，不证明此前没写入。 |
| handling.state | `unconfirmed / processing / processed`；只有目标成员显式 ack/处理回执推进 | 打开 UI、idle、输入清空都不算处理。无回执时保留 unconfirmed。 |
| ReplyObligation.state | `open / replied / cancelled`；结构化答复或明确撤销问题 | replied 不等于各方同意，更不等于任务完成；cancelled 不显示已回复。 |
| task.status | 现有房间 task start/done 等、普通任务 done/fail 等正式事件 | 不跟随投递回执、回复数量或终端忙闲改变。 |

回复可以直接到来，不强制先 ack；只更新指定问题的答复事实，不能把同批其他消息都标 processed。发给多个成员时，各人的投递/处理/答复独立。议题仅在有权操作者显式结束、且没有待发/不确定项和 open 义务后显示“议题已解决”；新来信使其重新出现待处理状态，原结束记录仍保留。

## 问题与答复

- Agent/发信 API 显式提交 `questions[]`，CLI 可重复传问题；人类收件箱只展示问题和答复。首版不从自然语言自动抽取或推断回答范围。
- 回复的 `answers: questionId[]` 必须显式列出。后台从认证身份确定回答哪个 recipient 的义务，并检查所属议题/范围；回复其他人的问题不会代替其义务。原文已从房间/CLI 主动读到也允许回复，不能为此伪造 submitted。
- 一次回复可回答 Q1、Q3；Q2 保持 open。回复的新消息、选中义务的 replied 和给提问者的收件记录由来源事务一起提交；回复本身待投递与“答复已记录”同时存在是正常状态。
- WaitLink 由当前任务负责人明确声明（也可无 taskRef 地声明本轮等待）。答复写入时不能立刻删除 WaitLink，否则尚未送到提问者的答复会失去优先级；由等待者明确接收/撤销等待或任务交差清除。
- 问题撤销沿用原发件人/用户权限，记录取消者与理由。撤回某成员的未投递收件项只取消该成员尚未回复的相关义务，不抹掉其他成员的回复。

例如 M1 问 Q1“total 的含义”、Q2“空 items 是否为 []”，均发给后端 B。B 回复 M2，`answers=[Q1]`：Q1=replied（链接 M2），Q2=open；M2 在提问者 A 的收件箱仍可为 pending。B 当前开发任务继续 active；A 的 WaitLink 保留到 A 接收 M2。

## 兼容和保留

旧 `request_reply` 消息映射为一个明确标记的 legacy question，沿用旧 --reply 的整条回复语义。新消息含多个问题时，仅 replyTo 表示引用；未传 answers 不能结掉全部问题。追问另发 discussion 并关联 topic，保留当前“回复不再要求回复”的规则。

旧 `deliveredTo/repliedBy` 是兼容投影：只有 submitted 才进 deliveredTo；该成员的全部问题义务都 replied 时才能概括为 repliedBy，取消应单列。不反向用这些数组覆盖新事实。

原文继续依托房间账本/普通任务来源，待发、未答和被引用原文不得因最近消息窗口或分页被清理。收件项终态、批次和源事件去重标记保留到对应来源可安全清理，避免 outbox 重放使已撤回项复活。
