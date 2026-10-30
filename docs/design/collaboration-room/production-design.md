# 协作房间 · 生产开发设计

> 状态：开发设计，评审后进入实现。
> 上游：`design-spec.md`（交互与产品约束，已在原型验证）、`index.html`（交互参照画面）。
> 本文回答：把验证过的房间交互落进 `src/` 与 `src-tauri/`，需要哪些数据、命令、组件与分期。
> 不依赖 `docs/collaboration-design.md`（协调者 / Worker 层级模型属于已移除的旧功能）；协作总线的现行定型决策与理由见 `src-tauri/src/collab/` 各模块头注释（旧稿 `docs/collab-bus-design.md` 已从仓库移除，仅存于 git 历史 ff30e88）。

## 0. 一句话

在既有协作总线上新增一层「房间」：房间是常驻的会话编组（归属一个项目），用户随时把任务发给任意成员；投递复用现有 Prompt 队列与 `belfry done` 交差协议，**成员完全不需要知道房间的存在**。

## 1. 复用清单与新增清单

复用（均已交付、有测试）：

| 能力 | 位置 | 房间怎么用 |
|---|---|---|
| 派活闸门与任务状态机 | `collab/task.rs`（judge / build_task / TaskBoard） | 房间派发走同一套闸门；新增 `TaskBoard::stop` 与任务来源标记 |
| 投递链路 | `collab_pending_tasks` 轮询 → Prompt 队列（750ms，`useTaskDelivery`） | 原样复用；房间任务与 Agent 互派共用一条队列 |
| 身份牌与 IPC | `SessionIdentities` / `CollabServer` / `belfry-cli` | 成员敲 `belfry done` 即房间任务的交差信号 |
| 会话名册 | `SessionRegistry`（`collab_sync_sessions`） | 成员在线状态、`can_receive`、项目归属判断 |
| 会话创建 | `workspace.launch(kind, …, projectRoot, activate, collaborationMode)` | 新建成员会话；返回 tabId |
| 协作启动隔离 | `collaborationMode`（`terminal/launch.rs` collaboration_env） | Codex/Claude 成员以 `true` 启动：隔离 Codex 运行时 SQLite 库；校验只接受 Agent 启动配置 |
| 会话命名 | `src/collab/naming.ts` | 成员加入时的命名引导与查重 |
| 全屏视图外壳 | `createOptionalPanel`（`src/components/lazy/`） | 新增 `room` 版式，复用 settings 同款全屏外壳与懒加载 / 错误恢复 |
| 持久化模式 | `app_data_dir` + 版本化 JSON + `atomic::write_atomic`（照 `provider/store.rs`） | 房间存储 |

新增：

- Rust：`src-tauri/src/rooms/`（store + commands + mod）。
- 事件模型小扩展：`CollabTask.origin`（来源标记）与 `TaskBoard::stop`。
- 前端：`src/rooms/`（api / contracts / model / hooks）+ `src/rooms/view/`（视图，按原型移植）。
- 挂载：App.tsx 状态与互斥、OptionalPanel 新 `room` 版式、侧栏工具区入口。

**不改**：`belfry-protocol`（CLI 协议不升级，无新命令）、`belfry-cli`、注入文本格式（仍是三行协议）。

## 2. 领域模型（Rust，`src-tauri/src/rooms/store.rs`）

```rust
struct Room {
    id: String,              // ulid
    name: String,
    project_root: String,    // v1 房间归属一个项目（见 §11）
    created_at: i64,
    members: Vec<RoomMember>,
    messages: Vec<RoomMessage>,
    decisions: Vec<RoomDecision>,
    tasks: Vec<RoomTask>,
}

struct RoomMember {
    id: String,              // memberId：ulid，消息/任务引用它，不随会话变化
    tab_id: String,          // 绑定的会话；「更换会话」只改它
    agent: String,           // 配置名（claude / codex / pi）
    role: String,            // 角色名，房间内唯一；历史消息按 memberId 解析显示名
    duty: String,
    joined_at: i64,
    left_at: Option<i64>,    // 软删除：离开后历史引用仍可显示，不再参与派发
}

struct RoomMessage {
    id: String, at: i64,
    kind: MessageKind,       // User | System
    author: String,          // "user" 或 memberId
    text: String,
    member_ids: Vec<String>, // 派活接收者（讨论消息为空）
    task_id: Option<String>, // 派活消息内嵌的任务卡片指向它
}

struct RoomDecision { id: String, at: i64, by: String, text: String, message_id: Option<String> }

struct RoomTask {
    id: String,
    title: String,           // 摘要（首 18 字，与原型一致）
    text: String,            // 派活全文
    member_ids: Vec<String>, // 接收者（多选）
    acceptance: Vec<String>, // 可选验收条件；原型里自动生成两条的行为不进生产
    created_at: i64,
    deliveries: Vec<Delivery>,
    verified_at: Option<i64>,
    verification_note: Option<String>,
    stopped_at: Option<i64>,
}

struct Delivery {            // 一成员一条（多选派发扇出）
    member_id: String,
    bus_task_id: Option<String>, // 关联 TaskBoard 的完整 id；应用重启后失效（见 §3）
    state: DeliveryState,        // Queued | Dispatched | Done | Failed | Abandoned | Unknown
    result: Option<String>,      // 交差回执（belfry done --result）
    at: i64,
}
```

**来源标记**（`collab/task.rs` 扩展，协议 crate 不动）：

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum TaskOrigin { Room { id: String, name: String } }

// CollabTask 增加字段；build_task 增加参数（CLI 路径传 None）
pub origin: Option<TaskOrigin>,
```

`collab/commands.rs` 的 label 解析改为：`origin.name`（「来自房间的派活」）→ 会话名 → tabId。这样 `CollabPanel`、注入文本里的「来自「…」」都自然显示房间名。

## 3. 任务生命周期与对账

派发时序（全部复用既有链路，无新传输）：

```
用户在房间写内容 + 选中成员 → room_dispatch
  → judge（from="room:<id>"，用户主控 → Allowed，不弹审批）
  → 每成员 build_task 一条 bus 任务（Queued）+ 记入 RoomTask.deliveries
  → 前端 750ms 轮询照常投递（等成员 idle，权限框前自动排队）→ Dispatched
  → 成员干活，在终端里看到三行协议，完成后敲 belfry done <短id> --result …
  → TaskBoard settle（Done/Failed）
  → 房间视图轮询对账：delivery 状态回写 + 追加系统消息（「角色」交差了：…）
  → 用户验证通过 → verified_at + 验证记录（可附备注）
```

**对账（reconciliation）**：房间存储与总线状态是弱一致，由 `room_*` 命令在每次调用时做写回（读 TaskBoard → 更新 deliveries → 追加系统消息 → 落盘）。约定：

- 应用重启后 TaskBoard 清空（它刻意只在内存里）。启动即处于 Queued/Dispatched 的 delivery 一律回写为 `Unknown`，任务显示「应用重启，投递结果未知」；用户可手动再派一次（同一任务新增一轮 delivery，旧轮保留为历史）。
- 成员在重启后才敲 `belfry done`，CLI 会如实报「没有这条任务」；这是可接受的最坏情形，不伪造成功。
- 交差系统消息的时间戳取对账时刻（总线不记 settled_at），文案如实写「对账时间」。

**任务整体状态（stage，派生规则，按优先级）：**

| 优先级 | 条件 | stage | 显示 |
|---|---|---|---|
| 1 | verified_at 存在 | verified | 验证通过 |
| 2 | stopped_at 存在 | stopped | 已停止 |
| 3 | 任一 delivery failed | failed | 有人交不了 |
| 4 | 所有 delivery done | submitted | 已提交待验证 |
| 5 | 有 done，其余在途（queued/dispatched） | running | 部分交差 |
| 6 | 有 done，其余 abandoned | submitted | 已提交待验证（标注谁掉线） |
| 7 | 全 abandoned / unknown | interrupted | 投递结果未知 |
| 8 | 有 dispatched | running | 已送达，完成情况未知 |
| 9 | 其余 | dispatching | 排队投递中 |

第 8 条沿用总线立场：`dispatched` 只代表指令进了对方终端，**不伪造进度百分比**（原型的百分比只是演示装置，生产改为如实状态 + 时间）。

## 4. 存储

- 文件：`app_data_dir()/rooms.json`，结构 `{ version: 1, rooms: [...] }`。
- 写入：`atomic::write_atomic`（同目录临时文件 + rename，沿用 `provider/store.rs` 的取向）；进程内一把 `Mutex` 串行化读改写。
- 放 Rust 而不是 localStorage：与任务状态机同侧、避免多窗口竞争、消息历史不受 localStorage 容量限制。
- 容量：每房间消息上限 500 条（超出裁最旧的系统事件，用户消息与决定不裁）；不存大文件，产物 v1 只有文本记录。
- 版本不认识时不覆盖文件：报错并保留现场，交给后续迁移处理。

## 5. Tauri 命令面（`src-tauri/src/rooms/commands.rs`）

```
room_list() -> RoomSummary[]                      // 侧栏/列表：id、名称、项目、成员数、活跃任务数
room_create(name, project_root) -> Room
room_rename(roomId, name) / room_delete(roomId)
room_get(roomId) -> Room                          // 全量 + 对账（§3）
room_add_member(roomId, tabId, role, duty) -> Room
room_update_member(roomId, memberId, role?, duty?, tabId?)   // 改角色 / 换会话
room_remove_member(roomId, memberId)              // 软删除（left_at）
room_send_message(roomId, text)                   // 纯讨论
room_dispatch(roomId, text, memberIds, acceptance?) -> Room  // 派活（§3 时序）
room_stop_task(roomId, taskId, memberId?)         // 整条或单成员停止（Abandoned）
room_verify_task(roomId, taskId, note?) -> Room   // 验证只有「通过」一条路径；退回重做见 §9 P2
room_mark_decision(roomId, messageId) -> Room
room_retry_task(roomId, taskId) -> Room           // 重启后 Unknown/Abandoned 的再派一次
```

派发闸门细节（复用 `judge`）：

- `from = "room:<roomId>"`，`to = 成员 tabId`；用户主控所以 verdict 直接 `Allowed`，不进审批队列。
- 沿用 `can_receive` 语义（running 且 idle 才可派）：成员正忙或被权限框卡住时**拒绝并给理由**，与 Agent 互派行为一致；「忙成员排队派发」不在此版引入（会分叉两个入口的语义，§11）。
- 同项目校验：成员快照的 `project_root` 必须等于 `room.project_root`，否则拒绝（「成员不在这个项目里」）。
- 不设每轮预算闸门（用户盯着屏幕，不同于 Agent 互派的自发扇出）；停止与一键全停照常可用。

## 6. 成员与会话

- **新建成员**：房间内选 Agent 配置（取 `environment.agents` 可用性）→ `launch(kind, undefined, room.project_root, false, collaborationMode)`；`collaborationMode` 对 Codex/Claude 传 `true`（`validate` 只接受这两个 Agent 配置；Pi 传 `false`，其隔离逻辑也只对 Codex 生效）→ 引导命名（建议名 = 角色名，复用 `naming.ts` 校验；角色 ≠ 会话名也没关系，房间内寻址用 memberId）→ `room_add_member`。
- **绑定已有会话**：从当前项目内在运行的 Agent 会话里挑；未命名的引导先命名（否则别的 Agent 寻址不到它，`CollabPanel` 里也只能显示 tabId）。
- **成员离线**：会话关闭后名册快照里消失，视图标「离线」；派发被闸门拒（「目标会话不在了」）。总线 `abandon_for` 会把该会话未结任务收成 Abandoned，对账照 §3 如实反映。
- **更换会话**：`room_update_member(tabId)` 重绑，memberId 与角色不变，历史完整保留。
- **一会话加入多个房间**：v1 允许，不设限制（总线不感知房间，任务路径各自独立）。

## 7. 前端结构与数据流

```
src/rooms/
  api.ts        // invoke 封装：room_list / room_get / room_dispatch / …
  contracts.ts  // TS 类型（与 Rust camelCase 对齐）
  model.ts      // 纯函数：stage 文案与色调、任务分组、成员在线合并、时间格式 —— vitest 直测
  useRooms.ts   // 列表 + 当前房间轮询（1.5s，照 useCollabTasks：错误保留上次数据、动作后立即刷新）
  view/
    RoomView.tsx        // 三栏：左＝房间与成员；中＝讨论 / 任务 / 产物；右＝进行中 + 已确认决定
    …子组件（消息流、任务卡片、派发输入区、成员对话框、验证对话框）
    room.css            // 原型 styles.css 收敛到生产 token 版
```

- **挂载**：`createOptionalPanel({ title: "协作房间", layout: "room", exportName: "RoomView", load })`；`PanelPresentation.layout` 枚举加 `"room"`（`PanelLoadFallback.tsx`：全屏，settings 同款外壳 + `room-view` 失败态样式）；App.tsx 加 `roomOpen` 与互斥块（照 `toggleUsage` 的写法，房间与用量/历史/协作面板/文件预览互斥）。
- **入口**：侧栏工具区（`sidebar-foot`）新增「协作房间」文字按钮，与设置 / 用量 / 历史会话并列。
- **数据流**：房间内容以 Rust 为准轮询 `room_get`；成员在线状态从 `workspace.tabs` 合并（phase / activity / canReceive）；派发输入区与原型一致（Enter 发送、Shift+Enter 换行、IME 组合态不发送；接收者多选）。
- **窄窗**：房间是全屏视图，内部左成员列在 ≤840px 收成顶部横向列表；状态永远带文字、原生控件与焦点管理沿用 design-spec。

## 8. 与既有协作面板的关系

- `CollabPanel`（右栏）继续服务「Agent 之间互相派活」；房间是「用户主导的编组派活」。两者共享同一 TaskBoard，互不冲突。
- 房间任务在面板里可见：`from_label` 显示为房间名，`stop_all` 的全局停止会收掉房间任务，房间对账后如实标注「已被全局停止」。
- 房间视图不复制面板的审批动线：房间派发无 `PendingApproval`（用户自己点发送就是批准）。

## 9. 分期与验收

**P1（最小闭环，可独立交付）**

- Rust：`rooms` 模块（存储 + 命令 + 对账）、`TaskBoard::stop`、`CollabTask.origin` 与 label 解析。
- 前端：房间视图（讨论流 / 派发 / 成员管理 / 任务状态 / 验证）、创建与删除房间、入口与互斥、命名引导。
- 验收：两三个真实 Codex/Claude 会话跑通「建房间 → 拉成员 → 派任务 → 成员终端 `belfry done` → 验证通过 → 记录归档」；重启后活跃交付如实标注 Unknown 且可再派；离线 / 跨项目 / 忙成员拒绝路径有单测；视图在 1440×960 / 1024×768 / 820×900 / 390×844 无横向滚动、双主题达标。

**P2（打磨）**

- ~~「标记为决定」、讨论搜索（按原型）~~ **已完成**（决定标记随 P1 落地；讨论搜索只筛当前房间的时间线，命中正文与任务标题）。
- ~~交差回执里的文件路径 → 打开 `filepreview` 预览；验证记录导出为文本~~ **已完成**（路径画链接、跨项目不画；任务详情的「复制记录」把全貌导出为纯文本）。
- ~~退回重做（验证不通过 → 生成一条带反馈的新派活）、单成员重派~~ **已完成**（单成员补投只重置「结果未知 / 已停止 / 失败」的投递，已交差的原样保留）。
- ~~通知中心：任务进入「已提交待验证」时提醒~~ **已完成**（App 层 3 秒轮询 `room_pending_reviews`；首次只做基线，用户在房间里且窗口在前台时不打扰、安静期不补发）。
- ~~布局变体（专注 / 紧凑，按原型）与快捷键~~ **已完成**（标准 / 专注 / 紧凑三种布局，选择记 localStorage；命令面板补「协作房间」键盘入口）。

**P3（增强，已按 p3-design.md 落地）**

- ~~跨项目房间~~ **已完成**（闸门判定未动：只把「与房间同项目」换成房间声明的范围）。
- ~~产物快照、`belfry rooms`（CLI 侧房间可见性）、多窗口、房间模板~~ **已完成**（2026-10-29）。

逐项结论、边界与风险见 [p3-design.md](p3-design.md)；上述五项已全部落地。

## 10. 测试

- **Rust 单测**（`rooms/store_test.rs`）：存储往返与版本处理、stage 派生规则表逐条覆盖、对账状态回写、重启 Unknown 回填、闸门拒绝路径（离线 / 跨项目 / 忙成员）、软删除成员后历史引用仍可解析；派发准备（`prepare_dispatches`）也由这里直接覆盖。
- **前端 vitest**：`rooms/model.ts` 纯函数（stage 文案与分组、在线合并、摘要生成）；`api.ts` 错误路径。
- **生产浏览器用例**：`src/components/lazy/testing/rooms-ui.case.mjs`（verify-plugins 按 `*.case.mjs` 自动收录，与 production-ui.case.mjs 共用夹具）。合成原生命令在 `rooms-uiNative.js`：内存房间存储 + `window.__roomsQA.settle()` 模拟成员交差后的对账推进；覆盖房间开合与互斥、派发流转、验证与停止闭环、决定标记、1.5s 轮询推进、1024 窄窗、自定义下拉选 Agent、模板建班子、独立窗口 `?room=` 启动与开窗命令调用。夹具只提供合成数据，不启动真实 CLI。
- **端到端手测**：真实会话跑完一轮真 `belfry done`；真实房间里用 `belfry room say/log` 走一轮互通（点名到真人会话、看它回话）——都不进自动化，作为发布前手动检查单。增补（2026-10-29）：在真实成员终端上点「清除上下文 / 清除所有成员的上下文」，确认真实收到 `/clear`（Claude）或 `/new`（Codex）并开始新会话、成员不离房；点「清空聊天记录」后确认时间线归空、右栏任务与决定仍在，且终态任务详情仍可打开。群聊语义增补（2026-10-29）：在真实成员终端里发一条不点名的群聊消息，确认真实会话收到的是聊天口吻的注入（「看见即可……没有补充就不必回复」，没有 `belfry done` 行、不产生任务卡），成员接话 `belfry room say` 后消息回到时间线；点名一条确认被点的人收到「请回一句」口吻、其余成员收到「看见即可」版本（点名不收窄送达）；用户在群聊里写「@某成员」确认同义（被点的人收到「点了你的名」）；对某条消息点「回复这条」，确认输入区出现回复横幅、发出后气泡带引用块、点引用块能跳回原消息；离开房间期间让成员发言后重进，确认时间线自动落在「以下为新消息」分隔线处（不是底部）、点掉之前再次进出分隔线仍在、点掉后消失且不再出现；离开房间期间让成员发言，重进确认新消息前有「以下为新消息」分隔线、点掉消失；真实成员 `belfry room react <短id> 👍` 点上再点一次取消，确认界面芯片计数与高亮跟着变；真实成员终端里跑一轮 `belfry room log` 拿到短 id、`belfry room say --reply <id> <话>` 引用回话，确认其他成员终端收到的注入行带「（回复 谁：「原话摘要」）」；对连发两条确认在成员终端里合并成一段（约 2.5 秒防抖后整段送达）；等成员空闲后在时间线确认注记从「发给了」变为「已送达」。输入法增补（2026-10-30）：用中文输入法在房间输入框打字，按回车选词——选词那一下不得发送、草稿保留，选完词再按回车才发出；新建房间对话框同理。房间列表增补（2026-10-30）：离开房间期间让成员说话，重进前左栏该房间条目出现未读圆点（悬停提示「有新消息」）；进房点掉分隔线后未读点熄灭；从未打开过的新房间不亮未读点。活跃度增补（2026-10-30）：房间条目副行显示最近活动时间（刚发言的房间显示「刚刚」，隔天变「昨天」）；重进房间时未读分隔线显示「以下为 N 条新消息」，N 与实际条数一致。@ 增补（2026-10-30）：在真实房间里打 `@`，确认点名单弹出、输入角色名过滤、回车选中插入 `@角色`（这一下不发送）、随后整条消息正常送出且被点成员的注入是「点了你的名」口吻。回到底部增补（2026-10-30）：翻到历史中间让成员说话，确认不拽底、出现「回到底部 · N 条新消息」浮标；点一下回到底部、浮标消失；自己把时间线拖回底部，浮标同样消失。发言增补：翻到历史中间发一条，确认视野自动回到底部并看到自己那条。点名收窄增补（2026-10-30）：真实房间 @ 一个成员发一条，确认只有被点成员的终端收到（另一位成员的终端里不应出现这条）；不 @ 发一条确认两位都收到；被点成员转手后交差仍回时间线。升级/dev 增补（2026-10-30）：dev 构建与正式版各起各的后台（`terminal-daemon-v1-dev` 与 `terminal-daemon-v1`）；在 dev 里新建成员会话后，在它的终端敲 `belfry room log` 应认得（拿到的是 `target/debug/belfry`），成员发言能回到房间时间线。若成员仍报「不认识的命令 room」，说明它由旧后台拉起，重建该会话即可。撤回增补（2026-10-30）：发一条群聊消息后立刻撤回，确认时间线标成已撤回、正文与回应不再显示；若消息已进成员终端，界面应标注「撤不回来」，成员终端里那条注入仍在（这是事实，不假装）。高亮增补（2026-10-30）：房间消息里带 @ 成员，确认对方名字在气泡里是高亮芯片、整句仍完整可读。

## 11. 风险与未决

- **弱一致性**：轮询对账最坏多等一个轮询周期（1.5s）；应用重启丢活跃交付（Unknown 回填，不伪造）。可接受，已在 §3 写清。
- **交差质量依赖成员自觉**：agent 可能不敲 `done`。沿用总线立场：如实显示「已送达，完成情况未知」，不自动置完成。
- **`can_receive` 的严格性**：成员 `talking` 时派发被拒。若真实使用中「忙成员排队派发」的需求强，需要同时评估放宽总线语义（两个入口不能分叉），届时单独改。
- **消息按 memberId 引用、显示用当前角色名**：成员改名后历史显示随之变化（与原型一致）；若需要留痕，改为消息内快照作者名——未决。
- **`collaborationMode` 对 Claude 目前只有校验层**（隔离逻辑只对 Codex 生效）：给 Claude 传 `true` 不产生额外行为，保留字段语义待后续对齐。
- **房间随应用而非随项目**：`rooms.json` 在应用数据目录，换机器 / 换仓库不带房间。若需要「房间随仓库走」，后续再议（文件位置只影响 `store.rs` 的根路径）。

## 12. 改动文件清单

Rust：

- 新增 `src-tauri/src/rooms/{mod,store,commands,store_test}.rs`；`lib.rs` 注册模块、`manage(Arc<RoomStore>)` 与 `room_*` 命令面（P1 时 15 条，其后陆续增补至 20 条，含 `room_clear_messages`、`room_react`；见实施记录）。
- `src-tauri/src/collab/task.rs`：`TaskOrigin`、`CollabTask.origin`（`with_origin`）、`TaskBoard::stop`。
- `src-tauri/src/collab/commands.rs`：label 解析优先 `origin`；`PendingTask` / `TaskView` 的 `fromLabel` 随之生效。
- `src-tauri/src/collab/server.rs`：`Inbox` 回执里房间来源显示为「房间「名」」；`mod.rs` 导出 `SessionRegistry`。

前端：

- 新增 `src/rooms/**`：`contracts.ts` / `api.ts` / `model.ts`（+`model.test.ts`）/ `useRooms.ts` / `view/RoomView.tsx` / `view/room.css`。
- `src/components/lazy/PanelLoadFallback.tsx`：`layout` 枚举加 `"room"`；`optionalPanel.css` 补整窗回退样式。
- `src/components/AppOverlays.tsx`：懒加载声明 `RoomView` 与 props 接线。
- `src/App.tsx`：`roomsOpen` 状态、面板互斥、`is-rooms` 壳类、`launchRoomMember`（协作模式拉起成员会话）。
- `src/workspace/components/Sidebar.tsx`：工具区「协作房间」入口。
- `src/workspace/workspace.css`：`is-rooms` 整窗规则（与 `is-settings` 同套）。
- `src/components/lazy/testing/`：`panels.tsx` 补新默认 props；新增 `rooms-ui.case.mjs` + `rooms-uiNative.js`。
- **未改** `src/collab/api.ts`：`TaskView` 已有 `fromLabel`，Rust 侧按 `origin` 填好即可。

不改：注入文本三行协议、`collab` 投递链路，以及派活闸门函数 `judge` 本身（跨项目房间只换了喂给它的项目判定输入）。
- P2 / P3 增补（2026-10-29）：Rust 侧另动过 `rooms/store.rs`（产物快照与对账采集）、`rooms/commands.rs`（待验证提醒、开窗命令）、`git/diff.rs`（工作区级 diff）、`collab/{server,registry,commands}.rs`（房间目录挂载、名册快照、`Rooms` 命令）、`crates/belfry-protocol`（`Command::Rooms` / `RoomBrief`）与 `crates/belfry-cli`（`belfry rooms`）；前端新增 `rooms/templates.ts`、`rooms/window/*`（独立窗口）与 `rooms/reviewNotifier.ts`，`main.tsx` 增加 `?room=` 启动分支。成员转手回显再增补：`rooms/store.rs` 添 `RoomDelegation`、`record_delegation` 与对账回显，`collab/server.rs` 添 `RoomDirectory::note_delegation` 并在 `dispatch_send` / `dispatch_room_say` 登记。

## 13. 实施记录（P1，2026-10-29）

- Rust `rooms` 模块与 15 条 `room_*` 命令已落地：`rooms::store_test` 10 项、`collab::task` 30 项全绿。过程中修复一处 bug——`verify_task` 写入 `verified_at` 后没有重算 stage，验证通过后仍显示「已提交待验证」。
- 前端整窗视图与接线完成：`pnpm build` 通过，全量 vitest 898 项通过；`rooms-ui.case.mjs` 生产浏览器用例通过（无控制台错误、无未处理原生命令、无横向滚动）。
- 落地时的两处小偏差：空房间时头部也保留「关闭协作房间」按钮（否则整窗视图只能靠 Escape 退出）；弹窗内会展示最近一次失败原因（打开弹窗先 `clearError`），避免错误藏在弹窗背后的时间线上。
- P2 第一轮（同日）：验证不通过「退回重做」已落地（`room_reject_task`；新增 `Rejected` 阶段，派生顺序为 验证 > 退回 > 停止 > 失败 > …；反馈拼进跟进任务正文、走同一套派发闸门、同一事务落库后再投递）；讨论搜索已落地（Escape 先清搜索、再关搜索条，不会顺手关掉整窗）；单成员重派已落地（`room_retry_task` 收可选 `member_ids`，只逐条重置没结果的投递）；「待验证提醒」已落地（App 层 3 秒轮询 `room_pending_reviews`，房间关闭时新交差的任务发系统通知；首次只做基线不弹旧账）；回执文件链接已落地（`splitResultPaths` 只认形状，`projectRelativePath` 按项目根落根校验，点击后收房间开预览）；验证记录导出已落地（任务详情「复制记录」，纯文本、无时间戳）；布局变体已落地（标准 / 专注 / 紧凑，选择记 localStorage）；命令面板补「协作房间」键盘入口（生产用例改从 ⌘K 进入）。生产浏览器用例同步扩到「命令面板开房 → 派发 → 验证 → 退回重做 → 停止 → 搜索 → 布局切换 → 单成员重派 → 待验证提醒 → 回执文件预览 → 复制记录」全链路。
- P3 第一项「`belfry rooms`」已落地：协议新增 `Command::Rooms` / `RoomBrief`，服务端经 `RoomAccess` 挂载房间目录（未就绪时如实回答「不在任何房间」），`RoomStore` 实现成员视角清单（只报进行中 / 待验证 / 等重派），CLI 渲染房间、成员与活跃任务，技能说明同步更新；协议、服务端、房间层、CLI 各有单测。
- P3 第二项「产物快照」已落地：对账在「有投递交差且快照落后」时采集工作区差异（32 KB 截断、不含未跟踪、空差异也留档），采集失败的根进程内记忆不再重试；任务详情「证据」折叠区与验证记录摘要行到位。采集点与 p3-design 原稿的差异（对账路径替代 done 响应路径）已回写该文档第 2 节。
- P3 第三项「跨项目房间」已落地：`Room.extra_roots`（范围只增不减），`room_add_member` 带成员项目根时顺势扩展并留系统消息；`judge` 不动，只把派发闸门的同项目判定换成房间范围 `covers_project`；房间头部标注项目范围。原稿未决项（是否自动收紧）定案为「不收紧」。2026-10-29 用户定调：添加成员对话框收敛为「选 Agent → 创建」，界面不挑已有会话，扩展机制保留在存储与协议层；对话框里的 Agent 选择用应用内自定义下拉（`components/controls/Select`），不用系统原生 `<select>`。
- P3 第四项「房间模板」已落地：`src/rooms/templates.ts` 常量模板（实现 + 审查、修复 + 验证），新建房间时可选，自动填名并预览班子；创建时逐个拉起成员会话并按角色命名，推荐 Agent 不可用退回第一个可用的。
- P3 第五项「房间独立窗口」v1 已落地：`room_open_window`（重复打开只聚焦）+ `?room=` 启动的独立视图；在场状态读协作名册快照（`collab_sessions`）；加成员/模板/文件预览留在主窗口，投递与提醒也只在主窗口，两边共享同一份房间存储。
- 「房间群聊」已落地（2026-10-29）：`belfry room say` / `belfry room log`、一间房一分钟 12 条限速；交差带结果时以成员口吻回显进时间线。协议、存储、总线、CLI、端到端各有测试。同日按用户定调改版：**不点名＝发给全体**——用户不选接收者发送走 `room_broadcast`（忙碌成员排队而非整条被拒、会话不在的成员跳过），成员 `room say` 不带 @ 同样群发；`@` 只用于点名（修订二后改为口径分层：点名不收窄送达）。放大效应与护栏见 p3-design 第 6 节。
- 「成员会话的隔离」已落地：房间摘要带 `member_tab_ids`，侧栏 / Quick Open / ⌘1-9 按隔离名单过滤（只隔离展示层，投递与名册不受影响）；移出成员或删房间后会话回到普通列表。成员行上的「关闭会话」入口同批落地：确认后结束进程并移出房间（仅主窗口）。
- 「回执一眼可见」已落地：任务卡带「已交差 done/total」计数，收件人标签按投递结果带勾/叉（`room-target--done` / `--failed`）；交差回显不再重复拖任务卡（卡只在发起消息下面出现一次）。浏览器用例在群发链路里断言 0/2 → 2/2 与回执勾；任务卡收成单行（状态 / 标题 / 计数 / 箭头同排，箭头不再换行掉到卡下），用例钉住卡高单行形状。收件人标签直接演状态：转圈＝还在回复（排队 / 已送达）、勾＝交差、红叉＝失败、虚框叉或问号＝已停止 / 结果未知；任务卡与右栏任务列表的计数在还有成员没回时带同款转圈（遵守减弱动效偏好）。用例断言：0/2 时转圈 ≥2、交完后归零、结果未知标签带独立标识。房间时间线滚动同期钉住：打开 / 切房落在最新一条、贴底时新回话自动跟随、翻历史或搜索时不拽回底；浏览器用例对三种行为都有断言。
- 「看终端在房间里」已落地（2026-10-29 用户定调：不要跳去工作台）：成员行点击改为开关房间右栏的内嵌终端（`rooms/view/RoomWatch.tsx` 复用 `TerminalViewport`），按 tabId 接驳已跑的守护会话（`attachmentId` 先取 `daemonSessionId`，缺了后端按标签回查，不重新拉起进程）；工作台正流同一会话时两路并存（后台本来就能被多路轮询；宿主侧订阅登记表原先按会话只留一路、后到的会把先到的掐掉，已改成按连接登记——否则看终端一开，工作台那一路就断了，成员行会冻在「空闲」而房间右栏明明在动）；成员行上正在看的那一条以强调色标出。独立窗口同样可用（名册切片缺启动字段时按 `agent:<kind>` 兜底）。原先「收起房间跳工作台」的接线已拆除（`onWatchRoomMember` 连同 App 层跳转一并删除）。浏览器用例覆盖：点成员行 → 终端嵌进右栏、工作台仍隐藏、讨论仍在 → 收起后右栏让回「任务与决定」；独立窗口步骤同样覆盖（名册切片缺启动字段，靠后端按标签回查接驳，收起还原）。点另一位成员直接换看、不必先收起：终端视图整块重挂，接驳身份跟着新标签走——修掉了带着上一位会话号接新成员、被守护按「项目或类型已改变」整条拒绝的问题；守护侧对不带启动目录的查看者（独立窗口名册只有标签）跳过目录比对，标签 / 类型 / 协作标志照旧核对。浏览器用例覆盖切换（新视图 + 正确标签 + 不带旧身份），Rust 单测覆盖查看者接驳与冒名拒绝，以及「同一会话两路并存、各按自己的回执释放额度、收起一路不影响另一路」；浏览器用例在打开看终端后驱动成员刷一帧「生成中」，断言左侧成员行转为「正忙」。
- 「右栏可拖拽」已落地（2026-10-29 用户要求）：房间右栏（「任务与决定」与内嵌终端共用同一列）复用 `panel/usePanelWidth` + `PanelResizeHandle`——把手挂在整个视图上、以 `--room-aside-width` 钉在列左缘，两种形态共用一份宽度；拖动提交写入 `belfry.rooms.v1.aside-width`，双击复位、键盘方向键与 Home/End 同样可用；专注布局与窄窗叠排下不出把手（没有左右可拖）。浏览器用例覆盖：拖动后右栏变宽且宽度入档、双击复位回默认。
- 「成员会话以退化网格创建」已修复（2026-10-29，用户报「左侧成员行一直空闲、右侧其实在跑」）：根因是房间打开时工作台被 `display: none` 藏着，fitAddon 把 `.terminal-canvas` 的计算宽度 `100%` 误读成 100px，拟出约 10 列的假网格，并作为出生尺寸发给后台；10 列画不下 Agent 状态行，工作台那一路的屏幕推断永远读到「空闲」。修复：新增 `src/terminal/controller/hostSize.ts`（`hostIsLaidOut` 只信 clientWidth / clientHeight 这类 used value；`initialGrid` 未布局时上报 80×24 兜底网格）；`layout.ts` / `view.ts` 的拟合与刷新统一走该判定，未布局一律不拟合；`lifecycle.ts` 建会话不再对隐藏宿主 `fit.fit()`，出生网格改用 `initialGrid`，等宿主真的布过局再由 ResizeObserver 拟合校正。单测：`hostSize.test.ts` 3 项；`terminalLifecycle.test.ts` 补 2 项（隐藏宿主 → 不拟合且上报兜底网格；已布局宿主 → 照常拟合真实网格，用非兜底值判别）。浏览器用例新增：成员会话创建尺寸必须可用（`cols ≥ 40`、`rows ≥ 10`），以及右栏看终端打开时成员刷帧「生成中」后左侧成员行必须转「正忙」；`production-previews/production-ui-room-final.png` 更新为「验证通过 / 已退回重做 / 已停止」三终态同屏的收尾全貌。
- 「成员转手的回复回时间线」已落地（2026-10-29，用户报「@ 一个角色后他把活转给别人，对方的回复不进聊天框」）：房间时间线原先只回显房间任务的交差，成员互相转手（`belfry room say @对方` 或同房 `belfry send 对方`）产生的任务不在房间任务表里，对账扫不到，聊天断在交接处。修复：`Room` 新增 `delegations` 转手登记（总线任务号 / 双方 memberId / `echoed_at` 幂等；旧 `rooms.json` 无该字段按空装载，存储版本不变）；`RoomDirectory` 新增 `note_delegation`，`dispatch_send` 与 `dispatch_room_say` 在任务入板**之后**登记（send 路径要求双方都是同房的在册成员，同处多间房时各记一份，一处都没有就静默跳过、不挡投递；room say 路径只登记点名（收窄）的转手、带房间 id 直记，群发是讨论不是交接、不登记）；`reconcile` 对未回显的登记找交差——带结果以接收方口吻回显进时间线、不带结果留系统摘要「「B」交差了」、任务记录丢失（应用重启）如实报「回复没能送达」且只报一次、停止 / 作废不宣布只记结；send 路径另在时间线补系统留痕「「A」把任务交给了「B」：摘要」（room say 不加：点名消息本身就是痕迹）。单测：`store_test` 2 项（回显三态与幂等、双侧在场与丢记录只报一次）；`server_test` 桩断言 room say 路径登记；端到端断言 send 留痕与两种交差回复回显。
- 「清除成员上下文」已落地（2026-10-29，用户报「房间里没有清除上下文的功能」）：成员行新增「清除」动作（Eraser；仅主窗口，独立窗口没有终端投递队列；Pi 没有已知的重置命令，不显示）。确认后把该 Agent 自己的重置命令——Claude `/clear`、Codex `/new`（`agentResetCommand`，`src/agent/contracts.ts`）——经与派活同一条 Prompt 队列送进它的终端：忙时排队、等空闲再送出，命令排在当前工作之后；进程、会话与房间身份保持不变，不移出成员、不关会话；收不了指令（会话不在 / 已退出 / 无命令）时错误栏如实报。单测：`agent/contracts.test.ts` 钉住三种 Agent 的映射；浏览器用例覆盖「点清除 → 确认 → 终端收到 `/new`、`/clear`，成员仍在房间里，且不关会话」。成员行改 flex 排布（尾部动作按钮可增删，不留空轨道）。生产预览新增 `production-ui-room-clear-context.png`（清除确认框，框内写明要发出的命令）。
- 「房间级清除上下文」与「清空聊天记录」已落地（2026-10-29，用户要求）：成员栏右上角新增「清除所有成员的上下文」——逐位成员把各自的重置命令经同一条 Prompt 队列送进终端（正忙排队；会话不在、已退出或无重置命令的成员计入未送达并在错误栏如实说明），不移出成员、不动进程；房间头部新增「清空聊天记录」——`room_clear_messages`（store `clear_messages`；命令面至此 19 条）只清 `Room.messages`，任务、决定、投递与转手登记一律保留，成员终端不受影响（否则清空等于把历史任务变得不可达）；时间线空态带 `room-timeline__empty`，房间有过任务或决定时说明「聊天记录已清空；任务、决定与投递记录保留在右侧」。右栏新增「已结束」区（`finishedRoomTasks`：验证通过 / 退回 / 停止 / 失败 / 结果未知），终态任务仍可点开详情、重派与复制记录。单测：`store_test` 1 项（清空保留任务 / 决定 / 转手、落盘重载、幂等）；浏览器用例覆盖「一键清除（前端 `/clear` 写入、成员仍在）→ 清空聊天记录（时间线归空 + 空态、决定保留、已结束区可达终态详情）」，独立窗口断言「房间级清除不提供、清空聊天记录可用」。生产预览新增 `production-ui-room-cleared.png`。
- 左栏成员列表可读性优化（2026-10-29，用户截图报「角色名与状态被截断」）：默认左栏 232→264px、窄窗一档 200→216px、紧凑一档 188→204px；成员行间隙 8→6px、行内动作按钮（清除 / 关闭 / 移出）从 26px 收到 22px——三个按钮同排时角色名（如「开发工程师」）仍有完整宽度，「空闲 · claude」不再截断；悬停提示带完整「角色 · 职责」。浏览器用例新增真实渲染宽度探针：把常见长角色名（「后端开发工程师」）与副行（「空闲 · claude」）临时写进每个成员行，断言 `scrollWidth ≤ clientWidth`——超宽即截断；用例对紧凑 <210px 与标准 ≥210px 的既有断言不变（204 / 264 均成立）。
- 「群聊通道」已落地（2026-10-29，用户目标：房间要像真人在群里沟通）：`belfry room say` 与「不选接收者直接发送」不再包成交差任务——`CollabTask` 增 `chat` 标记（`ChatDelivery { mentioned }`，`task::chat_task`），注入文案改成聊天口吻（不点名＝「见即可，没有补充就不必回复」，点名＝「回一句：room say @…」），不带任务号、不要 `done`；群聊不进 inbox（`Inbox` 过滤）、不进协作面板（`collab_tasks` 过滤）、送达回执（`RoomMessage.delivered_to`：对账把「进过谁的终端」如实写回消息，随后回收任务；只记送达，不假装读过——时间线注记从「发给了 …」演进为「已送达 … · 未确认 …」）、不占派活预算（`count_in_path` 豁免）。20 秒合并窗口：`TaskBoard::append_pending_chat` 把同房间、同接收者、仍在排队中的连发并进同一条注入，点名只升级不降级——成员读到一段对话摘录而不是被反复打断。时间线现场感：日期分隔（`formatRoomDay`）、同作者两分钟连发合并（`room-message--continued`）、谁在回复（`.room-typing` 读 talking 活动）、群聊消息标送达对象（「发给了 …」）而不挂任务卡与回执芯片。测试：`task_test` 3 项（聊天形状与口吻、合并窗口与点名升级、预算豁免）；`server_test` 覆盖群聊合并投递、收件箱为空与不登记转手；e2e 覆盖群聊投递与 inbox 过滤；浏览器用例覆盖群聊消息不生成任务卡、送达说明、日期分隔、连发合并与「正在回复」。CLI/SKILL 文案同步为「聊天，不派活」。同日修订二：点名口径分层——点名不再收窄送达（所有成员都收到），被点的人注入「请你说」、其余人「看见即可」；端到端新增旁观成员视角断言（收到同一消息、口径不同、合并与回执一体走完）。修订三：用户发言里的 `@角色` 与成员发言同义（`mentions_in`，送达不变、口径分层），`room_broadcast` 逐位成员给「请你说 / 看见即可」标志；聊天气泡内文件路径可点开预览、成员头像按作者散列着色、时间悬停给出完整日期（单测 `store_test` 1 项、浏览器用例 3 断言）。
- 「引用回复」与「未读分隔线」已落地（2026-10-30，参照 circlechat / NexusMCP / atcha 的同类交互）：`RoomMessage.reply_to`（Rust 校验引用目标必须存在，不落悬空引用；`room_send_message` / `room_broadcast` 增 `replyTo`）；消息悬停「回复这条」→ 输入区回复横幅（可取消）→ 气泡上方引用块（作者 + 摘要，点它跳回原消息；原消息被清后显示「引用的消息已不在」）。未读：每间房在 localStorage 记「读到哪」（贴着底浏览自然推进），重进房间时在新消息前画「以下为新消息」虚线胶囊，点掉或发出下一条即清除。测试：`store_test` 1 项（引用随行与校验）、`model.test` 1 项（`quoteSnippet`）；浏览器用例覆盖「点回复 → 横幅 → 发出带引用块 → 引用送达后端」与「离线新消息 → 重进出现分隔线（位于新消息之前）→ 点掉消失」。借鉴地图见项目记忆 rooms-chat-research-references。
- 「成员引用回复」已落地（2026-10-30，修订五，补齐群聊对话链最后一环）：`room log` 每行带消息短 id（尾 8 位，`[a1b2c3d4]`）；`room say --reply <短id或完整 id>` 引用某条消息回话——store 校验目标存在（找不到当场拒绝「没有编号 X 的消息」），落库为完整 id；投给其他成员的注入行缀上「（回复 谁：「原话摘要」）」现成摘录（`SayOutcome.reply_preview`），群里指代不靠猜。协议（`RoomSay.replyTo`、`RoomLine.id`）、CLI（`--reply` 解析与 log 渲染）、存储（短 id 助手 `short_msg_id`）、端到端（取 id → 引用 → 注入摘要、幽灵 id 拒绝）各有测试；前端零改动（`replyTo` 契约与气泡引用块上轮已通用，成员消息自动获得引用样式与跳转）。
- 「表情回应」已落地（2026-10-30，修订六，「我看见了」的最轻信号——只记事实，不占成员上下文、不注入终端）：消息悬停出现 👍 / ✅ / 👀 快捷回应，气泡下渲染芯片（计数、悬停显示谁点的、自己点过的高亮），点芯片即取消；成员侧 `belfry room react <短id> <表情> [--room]`（白名单 👍 ✅ 👀 🎉 ❤️ 🙏；同一人同一表情再点一次取消——切换语义让状态有界，不需要额外限速），`room log` 每行尾部带回应计数（`👍×1`），回执如实说「点上了 / 已取消」。Rust：`RoomMessage.reactions`（`RoomReaction { memberId, emoji, at }`）、`react_in_room` 切换实现（幽灵消息、白名单外表情、不在房里的成员一律当场拒绝）、`room_react` 命令（命令面至此 20 条）；协议新增 `Command::RoomReact` / `ResponseData::RoomReacted` / `RoomLine.reactions`（`RoomReactionCount`）。测试：`store_test` 1 项（成员与用户双向、切换、三类拒绝、log 计数）、协议 round-trip 与 CLI 解析各 1 项；浏览器用例覆盖「悬停回应 → 芯片计数与高亮 → 再点取消」。
- 「重进落在第一条未读」与「log 引用摘录」（2026-10-30，修订七）：重进房间自动滚到第一条未读（分隔线在视口内才有效），已读位只在点掉分隔线 / 在下面发言时推进——此前首帧跟底就会把已读位推平，分隔线会「自己」消失；`room log` 每行带引用摘录「（回复 [短id] 谁：「原话」）」，成员补课看得懂在回哪句；用户消息按「用户」标注（此前误标「你」——读 log 的是成员；`member_say` 的注入摘要同步带上短 id）。Rust：`RoomLine.reply_preview`（协议）；`store_test` 补 log 引用摘录断言；浏览器用例补「分隔线在视口内 + 点掉前已读位不推进 + 点掉后推进到最新」三断言。
- 「输入法选词回车不再误发」（2026-10-30，修订八，用户报告「我打字回车也会触发系统的回车事件」）：根因是 macOS WKWebView（Tauri 宿主）的 WebKit bug 165004——输入法确认候选的回车 `compositionend` 先于 `keydown` 派发，事件到处理器时 `isComposing` 已为 `false`，只剩 `keyCode === 229`（VK_PROCESS）可识别；只查 `isComposing` 的守卫全部漏判，房间里表现为中文打字按回车选词、消息被半截发出去。修复：新增共享判定 `composingKey`（`src/utils/keyboard.ts`：`isComposing || keyCode === 229 || key === "Process"`，附单测），把全应用 34 个文件的同类按键守卫统一收编——房间 composer 与三个对话框是首要目标，搜索框、下拉/日期/数字等控件、各处 Escape 处理、终端快捷键层的 `composingInput`（`chord.ts`）一并改为复用。浏览器用例按真实事件形状（`keyCode 229` + `isComposing false`）补两断言：composer 选词回车不发送且草稿保留、随后真回车照常发送；新建房间对话框选词回车不提交。另外把「事后 229」的默认动作也一并挡住：composer 防它多补换行（`suppressComposingEnter`）、9 个含文本输入的表单挂 `guardComposingEnter` 防隐式提交——只挡 WebKit 那种事后形状，真回车照常发送 / 提交；历史标签编辑器的 Escape 同步收编。
- 「房间列表未读标记」（2026-10-30，修订九）：人不在房间时成员说了话，左栏房间列表条目亮未读点——`RoomSummary.last_message_at`（Rust 侧对 `messages` 取最大时刻，清空聊天记录后为 `None`）＋前端按每房间本地已读位渲染（`.room-list__item.has-unread`：圆点 + `sr-only`「有新消息」，悬停标题加「有新消息」）。与未读分隔线同源：亮 ⟺ 进房会画分隔线；读到（点掉分隔线 / 发言）即灭；从未进过的新房不亮（没有已读位记录就不猜，与「首次进房不画分隔线」同口径）。Rust `store_test` 新增一项（发言推进时刻、清空后回 None）；浏览器用例新增三断言（不在场时亮、只亮说话的这间、读到熄灭）。
- 「最近活动与未读条数」（2026-10-30，修订十）：左栏房间条目副行带最近活动时间——`formatRoomActivity`（一分钟内「刚刚」、当天 HH:MM、跨天复用 `formatRoomDay` 的「昨天/月日」），一眼看出哪间房多久没动静；未读分隔线带条数「以下为 N 条新消息」（N＝分隔线起的时间线剩余条数）。`model.test` 新增一项；浏览器用例两断言（徽标带「刚刚」、分隔线带「1 条新消息」）。
- 「@ 点名单与按活跃排序」（2026-10-30，修订十一）：在输入框打 `@` 弹出成员点名单（与后端点名解析同一把尺——候选即在场成员，输入即过滤；方向键/回车选中、Escape 只收名单不关房间），选中插入 `@角色 ` 并把光标放好；Enter 的这一下只选人、不发送。左栏房间列表按最近活动时间排序（最近有动静的排最前，沉默的沉底）——聊天软件的列表习惯。浏览器用例新增四断言（@ 弹 2 位、过滤到 1 位、回车选中不发送、补全后整条正常发送 + Escape 不关房 + 活跃房排最前）。
- 「回到底部浮标」（2026-10-30，修订十二）：翻历史时新消息不拽人（既有语义）保持不变，但把增量攒成「回到底部 · N 条新消息」浮标——真人聊天里「错过的那几条怎么点回去」的肌肉记忆。浮标挂在时间线与输入区之间的零高度 `.room-jump` 锚上（不占布局），贴底、分隔线挂着、搜索中都由各自机制负责、不重复计数；点按钮或自己滚回底部即清，点按钮同时推进已读位（与贴底浏览同一口径）；发送成功后视野自动回到底部——发出去的消息要看得见（真人聊天的习惯，发完落在自己那条上）。浏览器用例四断言（浮标出现且条数为 1、点击回底、浮标收起、翻到最老再发送自动回底）。
- 「点名收窄投递」（2026-10-30，修订十三，用户报告「@了项目经理消息还是发给了另外的 agent」）：修订二把点名改成「全员送达、只分层口径」，实测不符用户预期——@ 谁就该只发给谁。改回收窄：`RoomStore::member_say` 与 `room_broadcast` 共用 `store::chat_targets`（点名收窄到被点的人；不点名才发给全体在场成员并排除发送者自己），被点者转手的交差仍经转办登记回时间线（交接不回退）。前端发送按钮按本地点名解析（`model::mentionedMembers`，与后端同一把尺）显示「发给 X」；`store_test` 新增 `chat_targets_narrow_to_mentions_and_exclude_the_sender` 并改点名断言；e2e 13b 改为「被点者收到、旁观者不收」＋群发合并与回执断言；浏览器用例补「注记只写被点成员」断言。SKILL/CLI 文案同步。
- 「dev 后台终端服务不再复用正式版」（2026-10-30，修订十四，用户报告「界面中没有回复信息了」）：根因不在界面——`belfry room say` 的注入确实送到了成员终端，但成员敲的 `belfry` 是**已安装正式版**里那份（不认 `room`，实测「不认识的命令 `room`」）。因为 dev 构建与正式版同 identifier、共用 `terminal-daemon-v1`，dev 实例复用了 10-24 起跑的正式版守护进程（PID 18660），而守护进程给 Agent 终端推的 CLI 目录取自**它自己的安装位置**（`launch::cli_directory` 用 `current_exe()`）。会话日志里成员自己说「当前 belfry 命令不识别群聊功能」，只能干等。修复：`terminal::daemon::directory_name()`——debug 构建用 `terminal-daemon-v1-dev`，与正式版各起各的后台（与协作 socket 按 pid 命名同一取向：同一个人同时开正式版与 dev 是常态）。Rust `daemon::directory_name_tests` 一项。注意：已在跑的旧后台不受影响（我这条会话就跑在它下面），也**不要杀掉它**——它服务着正式版与既有会话。新起的 dev 后台才会推 `target/debug/belfry`；此前用旧后台拉起的成员会话需重建才能回话。
- 「撤回消息」（2026-10-30，修订十五）：手滑发错能收回。`RoomMessage.recalled_at`（`#[serde(default)]`，旧 rooms.json 兼容）；界面在气泡悬停里给「撤回这条」＋确认框（`room_recall` 命令）；撤回后正文与表情不再显示、换成一句如实说明，撤回按钮消失。**诚实边界**：还没送出的投递当场从板上摘掉（`TaskBoard::drop_pending_message`——`ChatDelivery.lines` 与 `message_ids` 成对推入，按下标摘行，摘空了整条撤掉），成员不会收到；已经进过成员终端的撤不回来，界面按送达回执标注「（这条已经进过成员终端，撤不回来）」。成员 `room log` 读到的也是「（这条消息已撤回）」而非原文——瞒着成员只会让对话对不上。派活消息不走撤回（有任务在跑，要停去右栏停任务）。单测：`store_test` 新增撤回用例 1 项、`task_test` 新增投递摘行 2 项；浏览器用例补「撤回后正文隐藏、标已撤回、按钮消失」断言。撤回后的一致性：撤回的消息不再按原文被搜索命中（搜到却看不到原文只会让人以为出错）、不再给「记为决定 / 回复 / 回应」按钮、被别的消息引用时引用块显示「引用的消息已撤回」而非原文。
- 「气泡内 @ 提及高亮」（2026-10-30，修订十六）：正文里的 `@角色` 画成芯片（`.room-mention-chip`，强调色底），读对话一眼看清在叫谁——也是「@ 谁只发给谁」在视觉上的对应。实现：`model::mentionSpans` 从 `mentionedMembers` 抽出（同一把尺、与后端 `parse_mentions` 对齐），新增 `splitMentions` 把正文切成「普通文字 / @点名」段；气泡先按点名切、普通段再按文件路径切一次，两把尺拼回去都等于原文（不吞字）。高亮用**房间全部成员**（含已离开的）：历史消息里的点名照旧亮。`model.test` 新增 `splitMentions` 用例 1 项；浏览器用例补两断言（气泡里出现 `@审查` 芯片、正文完整可读）。
- 尚未做的验收项：真实 CLI 会话端到端手测（发布前手动检查单，见「测试」一节，增补：`belfry rooms` 在房内外的两种输出）；P2、P3 至此全部落地，P3 五项增强的落地记录、边界与风险见 p3-design.md；真实窗口行为（房间独立窗口的开/聚焦/关闭）、房间里切换成员看终端（守护多路接驳的真实路径）同样在手动检查单里。
