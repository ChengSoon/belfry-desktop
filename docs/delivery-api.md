# T4：任务持久化与提交回执

`send` 成功表示任务已受理并持久化，不表示写入终端，更不表示 Agent 已开工。
只有 Prompt 队列从终端收到的 `submitted` 回执会推进任务到 `dispatched`，或记录房间消息的 `deliveredTo`。
Agent 执行 `done` / `fail` 才是工作的完成信号。

## 展示字段

`collab_tasks()` 返回 `{ tasks: TaskView[], loadError: string | null }`。
每条任务增加 `delivery: { phase, attemptId, sequence, message }`；现有字段保持兼容。
`toTabId` 是稳定的目标会话 ID；定位终端使用它，不用会随改名变化的 `toLabel`。
`createdAt` 是 Unix 毫秒，任务 ID 与短编号在重启后保持不变。

| `delivery.phase` | 建议中文 | 含义 |
| --- | --- | --- |
| `accepted` | 已受理 | 任务已落盘，尚未交给 Prompt 队列 |
| `queued` | 排队中 | Prompt 队列已经接管，等待目标空闲 |
| `submitting` | 正在提交 | 已落盘提交意图，等待终端回执 |
| `submitted` | 已提交到终端 | 终端已确认提交，仍需 Agent 交差 |
| `uncertain` | 提交结果不确定 | 可能已写入，须核对目标终端；禁止自动重贴 |
| `cancelled` | 投递已取消 | 明确取消了尚未提交的投递 |

`state` 在任务尚未提交时使用 `accepted/queued/submitting/uncertain`；其余继续使用
`pendingapproval/dispatched/done/failed/abandoned`。工作状态与提交事实独立：用户中止已经写入的任务后，
`state=abandoned` 仍可同时有 `delivery.phase=submitted`。展示时保留 `delivery.message` 的原因。

`Room.deliveryOutbox` 是待投递的房间消息列表：
`{ messageId, memberId, phase, message }[]`。用它区分受理、排队和不确定；
只有真正提交后才从 outbox 移除，并进入对应消息的 `deliveredTo`。
历史窗口外的原文可从 `retainedMessages` 查到。房间消息不出现在普通任务面板。

## 投递命令

由 `src/collab/delivery.ts` 统一调用，展示组件不直接触发投递：

```ts
collab_claim_delivery({ id, attemptId }): Promise<boolean>
collab_release_delivery({ id, attemptId }): Promise<void>
collab_delivery_update({ id, attemptId, sequence, phase, message }): Promise<boolean>
collab_resolve_delivery({ id, attemptId, sequence, decision: "submitted" | "cancelled" }): Promise<void>
```

客户端生成 UUID 作为 `attemptId`；请求失败时重试同一编号，避免丢失 claim 回应后重复入队。
Prompt 项 ID 等于持久任务 ID。`beforeSend` 必须先等待 `submitting` 写盘成功，随后才允许 PTY 写入。
`queued/sent` 只表示接管；实际 observer 的 `submitted` 才补交提交事实。
回执失败时仅重试原序号与原回执，不再次调用 submit。迟到回执不能回滚新状态。
旧 `collab_mark_dispatched` 明确返回不支持，避免没有 submitted 证据就标送达。

人工核对使用 `collab_resolve_delivery`，sequence 传面板读到的原值。只有当前仍为 uncertain 且
attemptId/sequence 均未改变时提交决定，并由后端增加序号；否则返回 `CONFLICT`，前端刷新后重新核对。
人工 cancelled 表示放弃这次不确定投递，不能据此断言此前没有写入终端；它不会触发自动重投。

## 存储与恢复

普通任务位于应用数据目录的 `collab/tasks.json`，原子替换与跨进程文件锁保护 revision。
内存仅在提交成功后发布；磁盘错误、未知版本、陈旧写入都不会覆盖原数据。
房间操作与 `deliveryOutbox` 在 `rooms.json` 同一事务提交；若进程在房间提交后、任务受理前退出，
下次轮询会补受理。房间锁内复查 outbox 阻止迟到快照在回执清理后再次入队。

重启会释放尚未写入的 accepted/queued claim，让 Prompt 重新接管；submitting 变为 uncertain，
submitted 和已完成任务不会自动重投。房间 submitted 回执先提交进房间账本，再移除总线记录；
任何一边失败都能恢复，清理前后重复轮询不会重投。

PTY 写入与应用文件不是同一事务，因此崩溃发生在实际写入与回执之间时，只能保守显示不确定，
不能保证外部 Agent 已处理。当前仍保留会话中的手动核对/继续入口，重启后的 uncertain 任务不自动重置为 queued。

## 回归证据

- `src/collab/useTaskDelivery.test.ts`：queued/sent 不算 submitted；claim、释放和回执丢失后不重复入队；取消、手动确认与拉取失败。
- `src/prompt/runtime.test.ts`：提交意图落盘前不能碰 PTY；写入抛错时保持不确定而不自动重贴。
- `src-tauri/src/collab/task_persistence_test.rs`：8 项，覆盖重启查询和交差、各阶段恢复、迟到回执、取消、编号冲突、写盘失败及陈旧写入。
- `src-tauri/src/rooms/rooms_test.rs`：房间已提交而总线未受理的崩溃恢复、回执写盘失败恢复，以及清理后迟到投递快照。

旧实现对照在独立临时目录运行，未替换共享工作区文件：旧 Prompt runtime 稳定在 gate 前写 PTY，
抛错场景重复写 3 次；旧 shouldMarkDispatched 将 queued 认作送达。
旧 TaskBoard 使用应用当时的 `TaskBoard::default()` 初始化方式适配 `load`，运行同一“受理后重启查号”用例，
稳定失败于找不到已受理任务。该适配仅保留旧初始化语义，没有实现任何新的存储逻辑。

验证：协作 Rust 77 项、房间 Rust 44 项、atomic 3 项、logging 5 项通过；
前端 collab + prompt 91 项与 `pnpm exec tsc -b` 通过。CLI 二进制已重新构建，真实 IPC 端到端用例通过。
