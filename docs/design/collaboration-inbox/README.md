# 协作收件箱：首版设计（T60）

2026-11-10。基于 `main 9b5fc4d197937f7492329b62630b93f39ef16d29`；本目录只有设计建议，未接入生产、执行迁移或改变投递行为。按用户 `hw6z4w1y` 的最新要求，人类界面只提供简单会话列表和消息详情；合并、调度、发送交给 Agent 与后台。T61 的可点击原型由资深全栈开发工程负责，种子位于 `/Users/cheng/work/Project/tool/belfry-inbox-design`。

**消息先持久化收集，接收会话真正有可用输入机会时，后端才冻结一批。** 人类查看和 Agent 读取候选都不接管消息。已冻结内容不追加；后来消息进入下一批。

## 首版取舍

- 每个稳定会话一个调度入口和待处理提醒；一批只属于一个房间/来源、一个议题、一个接收成员。不同议题轮流投递。
- 新任务受“当前任务交差”门控；协商和对当前工作的答复只等安全输入机会。`idle` 不释放任务，`submitted` 不表示处理或回复。
- 原文、不同意见、附件和每个问题分别保留。只按显式议题、回复或任务关联归组；不做语义猜测、自动摘要或“最后一句覆盖前文”。
- 优先级只改变待发顺序；暂停、暂缓、离线、安全输入和不确定提交仍然生效。等待中的答复优先，但连续优先批次不能饿死普通消息。
- 收件项、冻结批次和问题回复各有内部状态；人类只看会话、必要等待原因和消息/答复事实，不需要操作议题、预览或批次。
- 首版复用现有账本、原子写、版本锁和回执套路，不增加通用工作流、自动任务拆分或任意依赖图。

## 文档

| 文档 | 内容 |
| --- | --- |
| [message-model.md](message-model.md) | 稳定身份、消息/收件项/问题/批次、处理与回复语义 |
| [dispatch-protocol.md](dispatch-protocol.md) | 持久化边界、就绪握手、任务门控、容量、公平性、竞争和恢复 |
| [api-ui.md](api-ui.md) | 会话列表/消息详情的精简只读契约，以及 Agent/运行时接口边界 |

## 当前源码依据

以下是本基线的事实；上面的新协议不能当作已实现。PR20 的其他分支内容未混入本基线。

| 位置 | 现状及设计落点 |
| --- | --- |
| [task.rs](../../../src-tauri/src/collab/task.rs#L244) `enqueue_room_post` | 同房同目标、20 秒内、`accepted` 且无 `attemptId` 才能合并；拼接上限 512 KiB。新设计保留单条来源，到投递机会再选批次。 |
| [delivery.ts](../../../src/collab/delivery.ts#L24)、[useTaskDelivery.ts](../../../src/collab/useTaskDelivery.ts#L12) | 每 750ms 拉取，先 claim 再调用 submit；忙时内容已由 Prompt 队列接管，后来消息不能并入。须改为接收者提醒和临投递取批。 |
| [runtime.ts](../../../src/prompt/runtime.ts#L61)、[contracts.ts](../../../src/prompt/contracts.ts#L32) | submit 先入内存队列；dispatch 才检查 running/idle、target、inFlight/paused。就绪证明必须来自这个实际输入运行时，名册 idle 只是线索。 |
| [ops.rs](../../../src-tauri/src/rooms/ops.rs#L57)、[set_paused](../../../src-tauri/src/rooms/ops.rs#L412) | 暂停时不创建 outbox，恢复也明确不补发。新设计是有意改变这一语义：暂停仍持久化收件项，恢复后有界投递。 |
| [store.rs](../../../src-tauri/src/rooms/store.rs#L395) | reconcile/pump_outbox 已处理跨文件恢复，锁内复查避免旧快照重新入队；继续采用提交后发布和幂等补偿。 |
| [task_persistence.rs](../../../src-tauri/src/collab/task_persistence.rs#L94) | 已有 attempt/sequence、提交意图和人工 CAS；重启 submitting→uncertain，不重贴。新批次必须保留这些约束。 |
| [model.rs](../../../src-tauri/src/rooms/model.rs#L179)、[ledger.rs](../../../src-tauri/src/rooms/ledger.rs#L131) | 当前待回复以消息和接收成员计，replyTo 会清掉此成员对整条消息的义务；新设计细分为 questionId。 |
| [ops.rs](../../../src-tauri/src/rooms/ops.rs#L619)、[task.rs](../../../src-tauri/src/collab/task.rs#L332) | 房间 start/done 和普通任务 done/failed/abandoned 是工作事实；当前没有统一的按会话串行任务占位。 |
| [registry.rs](../../../src-tauri/src/collab/registry.rs#L99) | tabId/唯一名用于寻址，agent 类型不用于匹配。新收件箱继续用稳定 ID，并保留具体 memberId。 |

原回执契约见 [delivery-api.md](../../delivery-api.md)，房间历史见 [room-history-api.md](../../room-history-api.md)。

## 后续实现验收场景

这是设计验收清单，**不是本轮已经运行通过的生产测试**。

| 场景 | 应可观察的结果 |
| --- | --- |
| 忙时收到同议题四条消息 | 四条原文落盘，一个成员提醒；此时没有已 claim 的四个 Prompt。下一次机会冻结一批。 |
| 同一议题既有下一任务又有当前工作的答复 | 答复可投，新任务仍显示“等待上一任务完成”。 |
| 一条消息两个问题，仅回复 Q1 | Q1 有答复链接；Q2 仍待答，其他成员的回复义务不变。 |
| Agent 读取候选后又收到一条补充 | 候选数量可变；已冻结批次的 IDs/hash 不变，新消息留待下一批。 |
| 优先/暂缓/撤回与取批并发 | 有明确的提交先后、影响范围或 CAS 冲突；不出现“撤回成功但仍按旧内容发送”。 |
| 两个窗口同时调度，同一模型的两个会话 | 同一 tab 最多一批在途；不同 tab/member 的消息、回复和任务占位互不混用。 |
| 暂停、离线、重启 | 未投递原文/问题仍可查；先恢复状态和身份再调度；冻结未提交可安全退回，提交不确定不自动重投。 |
| 源提交后/收件箱提交后/PTY 后分别崩溃 | 幂等补收、同批查询、uncertain 核对；不凭超时推断没写入。 |
| 超量及持续优先来信 | 每批有硬上限，旧消息有轮到机会，超长原文可分页读取，待答不因翻页消失。 |
| 已投递但未报告处理；当前任务只是 idle | 分别显示“处理情况未知”和“等待上一任务完成”，不能自动交差。 |
| 人类打开、切换会话、翻页 | 只读列表和消息，不 claim、不自动 ack、不触发发送；页面没有手动合批/调度/批次管理操作。 |

## 本轮核对范围

已对照上列源码及种子原型的数据逻辑，检查四份文档的相对链接/源码行号、JSON 示例和空白格式。并按“忙时收集→冻结后新来信”“策略与 begin 竞争”“崩溃恢复”“部分回复与任务占位”逐项核对状态约定。没有运行生产迁移、Rust/前端全量测试或把设计场景当作已通过的功能测试；可点击 UI 的验证由 T61/统筹完成。
