# 本地 A2A 1.0 协作契约（T11 / T12）

核查日期：2026-11-15。此文件是开发接口契约；完成范围和实际验证以 T13 的验收报告为准。

## 身份、自动发现与文件分工

T11 负责 Rust HTTP Gateway、任务/收件箱适配、原生诊断及内置协作 Skill 迁移、生命周期与 embedded 资产登记。T12 负责 `mcp-a2a-local-tools.mjs`、`mcp-dispatch.mjs` / `mcp-server.mjs` 接线、React/API、指南与最终验证。

所有 Agent API 沿用 `{api, args:[input], context:{workspace,sessionId}}`，返回 `{ok:true,value}` 或原有 AppError envelope。`sessionId` 是 MCP 宿主的应用 ticket；每次操作核验实际运行中的 PTY、对应前端 tab、canonical 项目与当前票据。工具输入不能提供 owner、ticket、PTY、bearer、URL 或 header。私密 Gateway bearer 另用随机数生成、只在 Rust 中保存、绑定当前调用实例，不复用公开 task generation 或 MCP ticket。

首期自动适配有宿主 MCP 注入的 Codex PTY 与 Claude PTY。`BELFRY_CODEX_NATIVE=1` 的隔离路径及其他尚无实际 MCP 注入路径的 CLI 不宣称自动支持。只有该实例实际读取新 MCP 工具目录后，Gateway 才登记就绪；无就绪/已退出/被替换的目标不进入可发任务的连接。忙碌是投递等待状态，不等于未完成任务已完成。

MCP `tools/list` 内部调用 `a2a.localReady`，参数 `{}`，使用它的真实 session context。此 API 不作为模型可调用工具发布；失败或返回 `ready:false` 不应阻断普通插件工具发现。返回 `{ready:boolean,adapter?:"mcp-pty",protocolVersion:"1.0",reason?:string}`。

已有 `a2a.connections` 为当前调用实例自动并入本地连接，无须填写本地 URL 或密钥；已保存外部连接保持原行为。本地 `ConnectionInfo` 增加可选字段：

```ts
local?: { tabId:string; agent:string; ready:boolean }
```

本地 ID 以 `local:` 开头，后接随机实例 ID，不能用来编辑/保存/删除外部连接。它仍由原 `A2AAgentCard` / `A2ASendMessage` / `A2AGetTask` / `A2ACancelTask` 通过同一 Rust A2A HTTP 客户端使用；不在 JS 另造客户端。本地公开凭据只有 `auth.hasCredential`，真实令牌不会返回 Node/UI。

新增 Tauri `a2a_list_local_agents({rootPath})` 返回下述 discovery，供界面查看真实适配状态；仅 main 窗口。该命令不授予 UI 代替 Agent 发任务的身份。

新增只读 Tauri `a2a_local_task_snapshot({rootPath})` 返回 `{tasks:ProtocolTaskPreview[]}`，供原任务板/房间界面按 `taskRef.kind + roomId + id + generation` 合并协议状态，不能覆盖权威业务状态。返回不含 ticket、bearer、sender owner 或 reportHandle：

```ts
type ProtocolTaskPreview = {
  taskRef:TaskRef;
  protocolTaskId:string;
  state:string; // 完整 TASK_STATE_* enum
  text:string|null;
  textTruncated:boolean;
  artifacts:{artifactId:string;name?:string;text:string;truncated:boolean}[];
  source:"localA2A";
};
```

UI 快照仅作预览：text 最多4096字、每产物预览512字；完整 direct 结果继续在原 task.result，完整房间结果/失败继续在原结果/备注/消息，Agent 也可读 LocalTask / LocalInbox。项目快照最多最近128条，明确预览标记，不把截断当完整验收产物。宿主重启后会从应用数据目录恢复最近一次协议预览；对应权威任务或房间已删除时不恢复，协议句柄本身仍然失效。unsupported.reason 使用固定代码 `adapterNotReady` / `adapterUnsupported` / `instanceUnavailable`，便于双语展示。

## Agent API

| API | input | value |
| --- | --- | --- |
| `a2a.localAgents` | `{}` | `{agents:ConnectionInfo[], unsupported:{tabId,name,agent,reason}[]}`；agents 是同项目其他已就绪实例 |
| `a2a.localTasks` | `{room?:string}` | `{tasks:LocalTask[]}`；当前接收方的有效 direct / room 任务，含恢复现有任务板任务所需的报告句柄 |
| `a2a.localTask` | `{reportHandle:string}` | `LocalTask`；完整指令和近期协议消息，不截断成投递摘录 |
| `a2a.localReport` | `ReportInput` | `LocalTask`；完成/失败/提问均需显式报告；重复 operationId + 同内容幂等 |
| `a2a.localInbox` | `{room?:string,messageId?:string,cursor?:string,limit?:number}` | 原 Inbox Agent List/Read 的 JSON，任务消息附 `reportHandle` / `generation`；limit 1–30、默认20 |
| `a2a.localRooms` | `{}` | `{rooms:object[]}`，包含 room ID / 名称 / 当前角色 / 目标 / 任务计数，限定当前成员 |
| `a2a.localRoom` | `{room:string,count?:number}` | `{roomId,status,log,tasks}`；复用原 RoomStatus / RoomLog，tasks 带真实 generation；count 1–50、默认20 |
| `a2a.localRoomSay` | `RoomSayInput` | 原 `RoomSaid` JSON，消息/问题/回复由原房间规则执行；回复问题不会完成任务 |
| `a2a.localRoomBrief` | `{room:string,objective?:string,focus?:string,constraints?:string[],operationId:string}` | 原 `RoomBriefUpdated` JSON，只有原引擎允许的统筹能改；Node 生成 operationId，同一实例同 ID 同内容幂等 |
| `a2a.localRoomTask` | `RoomTaskInput` | `{roomId,taskRef,task,agentReply?:AgentReply}`；分派给运行中适配 Agent 的 Add 经真实 A2A SendMessage，返回原客户端 taskHandle |

```ts
type TaskRef = {
  kind:"direct_task"|"room_task";
  roomId:string|null;
  id:string;
  generation:number;
};
type LocalTask = {
  reportHandle:string;
  generation:number;
  taskRef:TaskRef;
  task:object; // 标准 A2A Task，包含 status / 有界 history / 文本 artifacts
  instruction:string;
  source:{kind:"direct"|"room";roomId?:string;roomName?:string;taskId:string};
};
type ReportInput = {
  reportHandle:string;
  generation:number;
  state:"working"|"inputRequired"|"completed"|"failed";
  text?:string;
  artifacts?:{name?:string;text:string}[];
  operationId:string; // Node 在每次调用时生成；同一次网络重试保留
};
type RoomSayInput = {
  room:string;
  text:string;
  to?:string[];
  replyTo?:string;
  ask?:boolean;
  topicId?:string;
  questions?:string[];
  answers?:string[];
  operationId:string;
};
type RoomTaskInput = {
  room:string;
  op:
    | {op:"add";title:string;outcome?:string;assignee?:string;after?:string[]}
    | {op:"assign";task:string;assignee:string}
    | {op:"reopen";task:string}
    | {op:"archive";task:string};
  expectedGeneration?:number; // 非 add 必填；从 LocalRoom.tasks 获取
  requestId:string; // Node 生成，支持原 a2a.cancelRequest
};
```

RoomTask 的 `start` / `note` / `done` 使用绑定句柄的 LocalReport 替代，不开放绕过代次核验的第二条结果回报通道。房间角色和重开/换人规则仍由原 Rust 引擎决定；新入口不授予成员额外统筹权限。未分派的 Add 可作为任务板规划保留，返回值不冒充已向 Agent 投递。

统筹给自己建任务、成员给自己建任务或认领未分派任务沿用原规则，返回 `{roomId,taskRef,task}`；不伪造向另一个 Agent 发送的 agentReply。自身通过 LocalTasks / LocalReport 开工并交差。其他已就绪成员的 assigned Add 通过真实 A2A HTTP 返回附带 agentReply 的结果。

非 working 的 Report 必须有非空说明或文本产物，inputRequired / failed 必须有非空 text。text、产物合计最多64KiB，最多16产物；产物名最多120字/512字节。operationId/requestId 使用原1–128字节安全标识规则。句柄绑定 canonical 项目、实际 Agent 实例、任务代次；跨项目、他人、旧实例、重开/换人后旧代次均拒绝。句柄是归属查询键，不单独构成授权。

## 标准 HTTP 与权威业务状态

Gateway 只监听随机端口的 `127.0.0.1`；按目标实例提供 `.../agents/<id>/.well-known/agent-card.json` 与 `.../agents/<id>/rpc`。Card 描述 JSONRPC / 1.0、header bearer、文本模式，不宣称 streaming、push、OAuth、文件执行或通用 CLI 自动适配。Card 读取也需要已授权项目的 bearer，且不泄露身份令牌。

wire 使用 `A2A-Version: 1.0` 与 `Content-Type: application/json`、PascalCase `SendMessage` / `GetTask` / `CancelTask`。Send 返回 `{task:...}`；Get/Cancel 返回直接 Task。新 Send 的 `ROLE_USER` 文本创建现有权威任务；续写必须是该 sender/recipient/项目/实例/任务代次的同一非终态 Task。

direct 协议任务关联持久 TaskBoard，房间任务关联现有 Room task + generation；收件箱与原生输入闸门仍负责忙碌排队、完整消息、提交事实。协议 working/inputRequired 保留有界显式进度；completed 只在可信接收方成功结清权威任务之后返回，failed 必须显式说明，并在房间任务中保留失败备注/向统筹通知，不把失败记为 Done。重开后旧协议任务失败/失效，不能结清新代次。

普通 A2A Send 若双方同属协作房间，分派自动进入共同房间的任务板并执行原角色规则；若发送方没有向该成员派活的权限（例如普通成员之间），回退为 direct 任务而不是让共享房间阻断点对点协作。多个共同房间时需由 RoomTask 入口明确上下文。受控 RoomTask Add 在标准 Message.metadata 内携带宿主校验的房间业务语境；元信息不会绕过同项目或房间成员检查。不接受客户端提供 sender/target/generation 所有权。协议句柄保存在宿主内存中，应用重启后失效；最近一次协议状态与文本产物预览持久化到应用数据目录，UI 快照重启后仍可见。业务任务与房间任务板仍持久保留，接收方重新读取任务后可继续报告。

Send `returnImmediately:true` 立即返回 SUBMITTED/WORKING；false 或省略时等待终态或 INPUT_REQUIRED/AUTH_REQUIRED。等待达到宿主时限/连接断开返回错误或停止等待，保留未完成任务，不伪造完成。`historyLength:0` 不返回 history，正数绝不超过请求上限，宿主最多20条。

排队且未存在提交意图的 direct 任务可撤回，使用原收件箱的撤回/CAS与权威任务状态；已经提交/可能提交/正在执行的任务不能安全强停时返回标准 TaskNotCancelable。房间权威任务没有 cancelled 状态，首期 Room Task Cancel 返回不可取消，由统筹通过原权限的归档/重开管理，不能虚报 CANCELED。本地 HTTP cancel 只停止请求，不调用 Task Cancel，也不声称停止接收方执行。

## 验收边界

T11 原生 fixture 使用真实 Gateway HTTP 与同一个客户端、TaskBoard/RoomStore/InboxService 和可控合成 Agent 实例，覆盖显式报告、输入续写、默认等待、有界历史、取消、项目/角色/实例/代次拒绝。T12/T13 使用实际 embedded Node MCP transport 接这些正式宿主路由；不在 JS 重实现 Rust 客户端或任务状态引擎冒充贯通。真实模型与远端 Agent 未测试时明确记录，不以终端 idle 推断成功。

停止安装并删除仓库内的 Belfry 协作 Skill 资产；迁移只识别已知原样中英副本的 SHA-256，不覆盖/删除修改过的副本或其他 Skill，拒绝跟随符号链接。原生 onboarding/任务/收件箱提示改用上述可发现工具。旧 CLI 可留作人工兼容入口，但新协作不依赖它或 Skill。

T11 原生阶段验证记录（2026-11-15）：以下过滤集使用 `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked <过滤项> -- --nocapture`；过滤集之间有重叠，不合计为独立测试数。

| 过滤项 | 结果 |
| --- | --- |
| `a2a` | 42 通过：19 本地适配、18 外部客户端、4 迁移、1 票据/PTY 授权 |
| `collab::` | 111 通过，含真实旧 CLI 的人工兼容入口和新提示/代次检查 |
| `rooms::` | 74 通过，2 项原有显式 startup benchmark 忽略 |
| `setup::` | 12 通过 |
| `plugins::agent_connection::tests` | 5 通过 |
| `collab::identity::tests` | 8 通过；生产退出旧诊断辅助后保留测试中的单实例撤销检查 |

`cargo check --manifest-path src-tauri/Cargo.toml --lib --locked` 通过，无生产编译警告。A2A 与迁移 Rust 文件的 rustfmt 检查通过；补丁通过 `git diff --check`。

`local_a2a_two_embedded_mcp_sessions_use_real_http_and_bound_reports` 和首次目录恢复用例执行实际 embedded Node MCP transport → 正式 Rust typed route → Gateway HTTP → 权威业务状态与显式报告。`local_a2a_real_http_rejects_cross_project_access_without_business_writes` 为两个 canonical 项目各准备已就绪实例和有效 bearer，先验证各自 Card 成功，再绕过客户端连接解析直接双向访问对方的 Card、普通/房间 SendMessage、已有 Task 的 GetTask/CancelTask；拒绝后既有 TaskBoard、房间任务/outbox、Inbox 消息和 Gateway links 的快照保持一致。

这些用例使用临时存储、合成认证实例和受控输入闸门写入回调；没有启动真实 CLI 模型执行任务、调用真实 LLM 或迁移真实用户目录。全项目构建、插件/浏览器检查与最终指南验收由 T13 在最终代码上完成。
