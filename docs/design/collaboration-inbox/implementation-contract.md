# T62/T63 生产接入契约

实现基线 7ddf5e8（源码 main 9b5fc4d）。共享 Rust DTO：`src-tauri/crates/belfry-protocol/src/inbox.rs`，serde camelCase；枚举 class/phase 为 snake_case。能力标记为 `collaboration-inbox-v1`，schemaVersion=1。本页随实际实现同步，不把设计里的示例当成已存在的 IPC。

## 人类只读接口

- `collab_inbox_sessions({projectRoot, roomId: string|null}) -> SessionsView`。
- `collab_inbox_messages({sessionKey, roomId: string|null, cursor: string|null, limit: number|null, messageId: string|null}) -> MessagesView`。

完整字段以共享 DTO 为准：消息 `id` 是唯一收件项 ID，`messageId` 是原文 ID；`by` 为 `{id,name,tabId,memberId}` 对象。`replyTo` 是原文 ID，`questions[].replyMessageIds` 也是原文 ID。`replyPreview` 为可空的 `{messageId,by,createdAt,text,answers}`，自带被引用原文的预览，不依赖前端当前页的 Map。`deliveryStatus/handlingStatus/waitingReason/summaryStatus` 均为 `{code,params:Record<string,string>}`，`waitingReason` 可为 null。状态文案沿用 api-ui.md。

首页返回最新一页，页内按 `(createdAt,id)` 正序；`nextCursor` 向更早历史读取。游标绑定查询范围与稳定消息边界，不绑定全局 revision，新来信或新答复不会使历史游标失效。messages 默认 30 条、最多 50 条；Agent list/read 默认 20 条、最多 30 条。范围或格式错误明确报错。读取不改变状态、不 claim、不补写存储。

`revision` 汇总收件箱、来源及运行状态变化。前端刷新最新页时，也需刷新已经展开的历史页；单条历史原文可继续使用同一 `messages` 入口的 `messageId` 查询。若当前接收会话的回复引用了另一接收会话的原文，此查询允许在同项目、同来源房间内读取被引原文及其逐题最新状态。普通翻页仍只返回当前接收会话的消息。`pendingCount` 不含仅知会，`awaitingReplyCount` 只计已送达且仍 open 的问题。

## 切换与待收件提示

- `collab_inbox_capabilities() -> {schemaVersion,capabilities:string[],enabled:boolean}`。
- `collab_inbox_activate({operationId,legacyQueueDrained:true}) -> {schemaVersion,capabilities,enabled}`：前端先停止旧 DeliveryCoordinator、停止给旧 PromptQueue 添加协作项，确认未写入旧项不会再写，之后切换。后台同步撤销未开始的旧 claim；已有提交意图保守恢复为 uncertain。启用后旧 pending/claim/beforeSend 路径被拒绝，不能同时跑两种投递。
- `collab_inbox_pending() -> {revision,recipients: {sessionKey,tabId,projectRoot,pendingCount}[]}`：运行时只读提示，同一会话一项；可以定时拉取，UI 展示组件不调用投递方法。收件后台独立补 source outbox。

## 输入运行时

以下命令都使用 `{request: 对应DTO}` 参数；绑定中的 terminalSessionId 必须来自当前 target.getSessionId，不能用 tabId 代替。

| 命令 | DTO / 返回 |
| --- | --- |
| `collab_inbox_bind_target` | BindRequest → Binding（ownerId/targetEpoch/inputRevision）。同 owner/同 PTY 重复绑定保持 epoch；换 owner/PTY 作废旧 offer/guard。 |
| `collab_inbox_offer` | OfferRequest → Offer。必须 running、idle、composerEmpty、promptQueueEmpty 均 true，awaitingInput=false；binding.inputRevision 必须仍等于原生输入代次。offer 有效 5 秒。 |
| `collab_inbox_revoke_offer` | Offer → void。用户输入、交互框、target 变化或运行时卸载即撤销；旧 offer 不能被后续 ready 状态复活。 |
| `collab_inbox_prepare` | PrepareRequest → PrepareResult（batch 或 blocker）；后台选择最新合格收件项并冻结，不能由前端传自拼正文。相同 operationId 幂等返回同批。 |
| `collab_inbox_begin_submit` | BeginRequest → BeginResult（batch + writeGuard）；持久化意图成功才给 guard。 |
| `collab_inbox_receipt` | ReceiptRequest → BatchView；phase 只接受 submitted/uncertain，sequence 单调。submitted 必须有提交意图与原生 guarded write 事实。仅 queued/sent 不得上报。 |
| `collab_inbox_abort_prepared` | BatchRequest → BatchView；仅无提交意图时退回 pending。 |
| `collab_inbox_batch_get` | `{batchId}` → BatchView；只读查询，不创建新写入许可。 |
| `collab_inbox_resolve` | ResolveRequest → BatchView；原 attempt/revision/sequence 做 CAS，只确认 submitted 或 abandon，不自动重发。 |

`batch.id` 是本次 Prompt 投递的去重 ID。前端只在已保留的实际输入位置发送 `batch.payload`，不能把它再放进普通等待队列；写入前再次检查本地 target/输入代次和选择框。准备后失去输入位置，尚无意图则 abort；跨过 begin 后结果未知则 uncertain。

### 实际 terminal_write 的 guard

现有 `terminal_write` 扩为：

```ts
invoke<void>("terminal_write", {
  sessionId,
  bytes: Array.from(bytes),
  inboxGuard: writeGuard ?? null,
  writeSequence: sequence ?? null,
});
```

一批的所有程序化写入（粘贴、提交键）携带同一个 writeGuard，writeSequence 从 1 连续递增；重复相同序号/字节只返回原结果，不再次碰 PTY；跳号、不同内容重用序号或过期 guard 拒绝。发送器只在本次 sendText 的写入闭包中传 guard，不能用全局变量把用户键盘输入误标成该批。原生写入许可从 authorize 起最多 30 秒，使用单调时钟，不依赖后台来源同步及时运行。

guard 绑定已冻结的 `batch.payload`。Rust 仅允许完整 bracketed-paste 帧 `ESC[200~ + payload + ESC[201~`；接受正文 LF、CR、CRLF 的等价换行规范化，允许按连续序号分片。每一片先验证是授权帧的前缀，再碰 PTY。完整正文和结束帧成功写入后，才允许一次 Enter（CR/LF/CRLF 或既有 CSI-u Enter）。任意短正文、缺正文、缺结束帧都不能获得 submitted 回执。正文内不安全控制字符在冻结时转成可读转义；来源原文保持原样。

原生层必须先从实际终端输出观察到 `CSI ?2004h`，才接受 offer/guard；模式被关闭时拒绝写入。未开启 bracketed paste 的输入位置继续排队，不能把多行原文直接写成多个 Enter。T63 仍需保证这是 Agent 的安全空输入区。

用户写入保持 guard=null。Rust 在同一输入仲裁锁下先推进 inputRevision/撤销旧 offer，再写入；因此用户抢先输入会使旧准备失效。xterm.onData 产生的自动协议应答也不带 guard：原生层先观察 PTY 发出的 DSR/DA/状态/模式/窗口查询，再豁免相匹配的短期应答；未请求、过期、混入用户文本的应答不豁免。这样 `ESC[6n` 对应的游标应答不会在 paste 与 Enter 之间误撤销批次。已开始的一批被其他输入打断则保留 uncertain，不自动补贴。guard 不取代 T63 的输入区/权限选择检查；这些必须来自真实 target，不能用名册 idle 代替。

回执失败只重试原回执；begin 结果丢失不可直接重发正文。submitted 只释放本批输入占用，不释放正式任务占位。uncertain 阻塞该 sessionKey 跨房间后续全部自动投递；人类只读查询与新消息持久化继续。

## Agent 入口

`belfry inbox` 保留普通任务列表；新增 inbox 子命令走 `Command::CollaborationInbox {command: AgentCommand}`，完整操作结构见共享 DTO。新 room say 元数据通过 `MessageOptions` 承载 topicId/questions/answers/class/correctionOf/operationId；旧 --reply 对 legacy 问题保留兼容语义。CLI 同时检查新能力标记，穿过旧 daemon 时用已有 opaque room compatibility 通道，避免新字段被旧枚举重编码丢失。

```sh
belfry inbox list --room <room-name>
belfry inbox read <message-id>
belfry inbox ack <entry-id>@<revision> --state processing --op <operation-id>
belfry inbox wait --question <question-id> --op <operation-id>
belfry inbox policy --room <room-name> --topic <full-topic-id> --revision <n> --hold-until manual --op <operation-id>
belfry inbox withdraw <entry-id>@<revision> --op <operation-id>
belfry inbox batch <batch-id>
belfry inbox resolve <batch-id> --attempt <attempt-id> --revision <n> --sequence <n> --decision abandon --op <operation-id>
belfry room say <text> --room <room-name> --topic <topic-id> --question <question-text> --op <operation-id>
belfry room say <text> --room <room-name> --answer <question-id> --op <operation-id>
```

`ack` 仅固定接收成员可写，处理回执不会伪造送达或释放任务占位。`withdraw` 仅原发送者/当前房间统筹可写，并拒绝已开始提交的内容；仅取消被撤回成员尚未回答的问题，保留已有答案和其他成员的义务，取消事实补回来源账本。议题策略只可作用于自己的接收范围。每个更新操作以原 revision 和 operationId 判定竞争，同 ID 改内容被拒绝；房间消息受理回执独立于历史窗口持久保存，裁剪/重启后重试不会再次发消息。

`wait` 声明自己所提问题或当前任务的等待关系，立即返回；Agent 应结束当前轮次，让答复有输入机会。显式 `--answer` 仅关闭列出的 questionId，跨议题或非本人被问的问题被拒绝；同次回答多个提问方时，每位提问方收到一条仅含自己问题编号的回复。任务交差使用注入正文给出的 `--generation`，重开或改派后旧代次的完成回执被拒绝。

不确定批次通过 Agent CLI 核对。原接收成员或当前来源房间统筹可 `batch/resolve`；先核对目标终端，再选择 `submitted` 或 `abandon`，没有重发选项。**若来源房间已删除，仅冻结批次中的原 tab 保留读取和核对权**，其他房间的统筹不继承权限。确认/放弃后解除该 sessionKey 的不确定阻塞，旧批次正文仍不重投。人类界面保持只读；内部 `collab_inbox_resolve` 不作为页面操作入口。

## 存储与调度

- 房间 `rooms.json` 升为 v4，任务 `tasks.json` 升为 v2，收件箱 `collab/inbox.json` schemaVersion=1。来源先提交，再由独立 500ms 后台同步补收；来源已保存而尚未补齐时，读模型显示 `source_sync_pending`。未知格式只读并保留原文件。
- 事务使用文件锁、版本比较、原子提交后发布；涉及来源与批次时锁序为 Room→Task→Inbox，锁不跨 PTY 写入。submitted/abandoned 先落收件箱，再幂等补回来源；补回失败只重试持久事实，不重贴正文。
- v3 房间沿用已有已提交投影，升级不重读整份账本；保留成员扩展字段，包括 T64 的 `modelOverride`。v1/v2 房间只重放已提交历史。旧 writer 不能覆盖升级后的新格式。
- 新任务在受理时保存目标项目；新模式中，名册里已登记的同项目 Agent 即使忙、等输入或离线也能持久收件。不存在/含糊的目标或跨项目仍拒绝。旧普通任务缺项目时先留在任务来源，固定 tab 的项目可用后只固定一次，后续改项目不会把旧任务改投新项目。
- 批次只含一个来源房间、议题及固定接收身份；上限 20 条、32 KiB、32 个问题。新任务独占一批；超长单条改投稳定全文引用，正文可用 `inbox read` 查看。仅知会不单独唤醒，可随同议题未处理内容同行。
- 协商收集截止为 `min(最早+5秒, 最近+2.5秒)`，持续来信也有上界。等待答复优先于高优先级，再是普通消息；连续两批优先内容后，轮到最老的合格普通项。暂停、依赖、暂缓、原生输入及不确定门控优先于此排序。
- 应用恢复时 prepared→aborted/pending，submitting→uncertain；撤回/取消/迟到回执不能让已提交或已放弃的内容重新排队。正式任务的生命周期完成事实释放任务占位，协商与轮次空闲不代替交差。

## 状态与序号（T63 接线定稿）

`QuestionView.state` 为 `open/replied/cancelled`。`runtimeAvailability` 为 `ready/busy/needs_input/offline/unavailable`。一次 sessions 查询一个 projectRoot（接受项目路径或 file URI）；多项目分别查询，再以 sessionKey 合并。sessionKey 由后端对规范化项目根与 tabId 生成，不能由前端拼接。

| code | params | 语义 |
| --- | --- | --- |
| `turn_busy` | 无 | 目标正在运行当前轮次 |
| `previous_task` | `task` | 等该正式任务交差 |
| `room_paused` | 无 | 房间暂停，继续收集 |
| `topic_held` | `until` | 议题暂缓到毫秒时间戳；9223372036854775807 表示 Agent 主动暂缓到恢复 |
| `target_offline` / `target_changed` | 无 | 目标不在线或固定身份已变化 |
| `awaiting_input` / `composer_not_empty` | 无 | 正在等交互输入或输入区已有内容 |
| `source_sync_pending` | 无 | 原文已经保存，后台正在补齐 |
| `runtime_not_ready` | 无 | 目标未绑定或运行时不可投递 |
| `task_dependency` | `task` | 等前置任务 |
| `approval_required` | 无 | 等已有的派活批准 |
| `queue_turn` / `collecting` | 无 | 等待轮次／短暂收集 |
| `prepared` / `submitting` / `uncertain` | `batchId` | 已冻结／提交中／待核对；uncertain 阻塞整个 sessionKey |
| `submitted` / `reference` | 可含 `batchId` | 已提交完整原文／超限后的稳定全文引用 |
| `processing` / `processed` / `unknown_handling` | 无 | Agent 明确处理回执／尚未确认处理 |
| `withdrawn` / `abandoned` / `fyi` | 无 | 已撤回／已放弃／仅知会 |
| `mixed_waiting` | 无 | 部分消息等待投递，原因不相同 |
| `waiting_reply` | 无 | 已送达的问题尚未全部答复 |
| `ready` / `empty` | 无 | 没有待投递阻塞／还没有消息 |
| `capacity_exceeded` | 无 | 连稳定引用也无法装入当前容量 |

状态码用于展示，不授权写入。部分码保留供运行时展示本地阻塞原因；后端 offer 输入不满足要求时返回错误，不制造批次。未知码使用通用文案。

`receipt.sequence = beginResult.batch.sequence + 1`。网络重试使用同一个 sequence、phase、payloadHash 和 message，不另加序号。`terminal_write.writeSequence` 是独立的逐写入序列，从 1 开始；最后的提交键也有自己的序号。提交键写入之后只允许重放已经执行过的相同序号，不再接受新写入。原生证据仅证明这次 PTY 写入成功，不表示 Agent 已读或任务完成。

`resolve.sequence` 是 batch_get 返回的当前 sequence，用于 CAS；后台自行推进下一序号。decision 只接受 `submitted` 或 `abandon`。准备失败返回的 blocker 和详情状态可能携带 `batchId`，供查询；不能据此重发。

切换时先查询能力。命令不存在才启用旧投递路径；命令存在时本次不启动旧 owner，或先停止并清空其未写入项，然后 activate。activate 部分失败后保持新路径不可投递，不启动旧 dispatcher。后端在任务存储锁内关闭旧 pending/claim/beforeSend；切换标记持久化，重启继续有效。

## T62 验证与整合

2026-11-11，本地 macOS、独立 worktree/target，测试数据均为临时目录：

| 检查 | 结果 |
| --- | --- |
| `cargo test --locked --offline -p belfry-desktop --lib collab:: -- --test-threads=4` | 107 通过；其中收件箱 28 项，含忙时收集、冻结不可变、逐题/多提问方、状态版本、等待答复优先、公平性/容量、断点恢复、删除房间核对、只读分页与跨会话引用、撤回和幂等 |
| `cargo test --locked --offline -p belfry-desktop --lib rooms:: -- --test-threads=4` | 59 通过、2 个原有手动基准忽略；含 v3→v4 不重读账本及角色模型扩展字段保留 |
| `cargo test --locked --offline -p belfry-desktop --lib terminal:: -- --test-threads=4` | 139 通过；含原生 guard 10 项、现有真实 PTY/daemon 生命周期与输入输出回归 |
| `cargo test --locked --offline -p belfry-cli -p belfry-protocol` | 61 通过；含新字段通过旧 relay、能力检查、单次提交、CLI 截止时间 |
| `cargo check --locked --offline -p belfry-desktop` | 通过；14 个 IPC 均已实际注册 |
| 词库目录导出检查、`node --test scripts/backend-i18n.test.mjs` | 导出同步、3 项通过 |

原生 guard 的新场景在真实仲裁器下使用可计数写入器，证明拒绝错误/缺失正文、相同序号不重复触碰 PTY、DSR 应答不撤销、未启用安全粘贴不写入。T65 在整合分支另验证了真实 xterm（替换原生 IPC）与实际 Rust 运行时/PTY/批次回执（隔离终端消费者），未在同一条测试中贯通浏览器到实际 Tauri IPC；具体结果见[整合验收](../../collaboration-inbox-verification.md)。本分支未运行 Windows 原生环境，也未向用户真实 Agent 注入测试消息。

整合 T64 时保留 `Member` 的未知扩展字段，已保存的 `modelOverride` 应转入其正式字段；T62 不接管模型设置。恢复房间通知已更新为“待发消息按议题投递”，保留既有状态码 `ROOM_YOU_RESUMED_THE_ROOM_NEW_MESSAGES_WILL`；合并前端后执行 `node scripts/sync-backend-i18n.mjs` 同步这一个既有词条。T62 未修改 `src/` 界面文件。

首版收件箱以原子 JSON 和全量内存投影实现，保留终态/批次/操作去重记录；未增加后台归档清理或数据库索引。旧普通任务缺少项目且原 tab 始终未重新登记时，继续保留在原任务文件，等待项目可确定后补收，不猜测其他接收目标。
