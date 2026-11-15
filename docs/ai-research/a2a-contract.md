# A2A 1.0 宿主接口契约

日期：2026-11-15。T8 / T9 的共同契约，生产实现前发布；以本文件及任务板补充协调变更。T8 负责 Rust / IPC / 宿主回调，T9 负责 TypeScript / UI / Node 工具。wire JSONRPC 使用 A2A-Version=1.0、Content-Type=application/json；release v1.0.1 是补丁。

## 公开连接与编辑类型

以下是 JSON / TypeScript 表达，Rust 使用相同 camelCase 字段。

```ts
type AuthKind = 'none' | 'bearer' | 'apiKey';
type CredentialEdit =
  | { action: 'keep' }
  | { action: 'replace'; value: string }
  | { action: 'clear' };

interface ConnectionDraft {
  id?: string;                 // 有值只表示编辑已有连接，不能指定新连接 ID
  name: string;
  cardUrl: string;
  interfaceUrl?: string | null; // 空值按 Card 顺序选择兼容项
  interfaceTenant?: string | null; // 仅有 interfaceUrl 时有效；同 URL 多 tenant 时用于区分
  auth: {
    kind: AuthKind;
    headerName?: string | null; // apiKey 时为 header 名
    credential: CredentialEdit;
  };
}
interface ConnectionInfo {
  id: string;
  name: string;
  rootPath: string;             // 宿主 canonical 项目目录
  cardUrl: string;
  interfaceUrl: string | null;
  interfaceTenant?: string | null;
  auth: { kind: AuthKind; headerName: string | null; hasCredential: boolean };
  revision: string;             // 每次保存更换，旧任务句柄失效
}
interface AgentInterface {
  url: string;
  protocolBinding: 'JSONRPC';
  protocolVersion: '1.0';
  tenant?: string;
}
interface Discovery {
  card: Record<string, unknown>; // 已核查必需形状的 Card，保留自述属性
  interfaces: AgentInterface[]; // 按声明顺序，只有 JSONRPC / 1.0 兼容项
  selectedInterface: AgentInterface | null;
  issue: { code: string; message: string } | null;
}
```

匿名使用 clear；Bearer / API-key 新建时必须 replace 非空凭据。keep 仅可保留当前项目已有连接的同类认证、同 header 和同凭据 origin；改变 origin / 类型不能悄悄携带旧机密。clear 可使已保存静态认证进入未配置状态，发现 / 发送时显示需要凭据。公开对象永远没有 credential.value 或原凭据。

目标只允许无 userinfo / fragment 的 HTTPS，显式 loopback 本地 fixture 可以 HTTP。不跟随重定向。Card 与默认 interface 不同 origin 时，Discovery 返回 selectedInterface=null 和 A2A_INTERFACE_SELECTION_REQUIRED，UI 指定所选 interface 后重新检测。凭据只发送到明确配置的 origin；Card / RPC 两个 origin 需要不同凭据的组合首期不支持。

## Tauri 命令

| 命令 | 入参对象 | 成功返回 |
| --- | --- | --- |
| a2a_list_connections | `{ rootPath }` | `ConnectionInfo[]`，仅指定 canonical 项目 |
| a2a_save_connection | `{ rootPath, draft }` | `ConnectionInfo`；公开 metadata 与受 OS 密钥保护的密文一致提交 |
| a2a_remove_connection | `{ rootPath, connectionId }` | `null`；撤销连接的本地请求 / 句柄，不冒充远端 CancelTask |
| a2a_probe_connection | `{ rootPath, draft, requestId }` | `Discovery`；使用 draft 或 keep 后的凭据，读取 Card，检查 interface / 认证 / 模式，不发任务也不保存 |
| a2a_cancel_request | `{ rootPath, requestId }` | `boolean`，表示找到在途 UI 请求；取消先到时也记录有界取消标记，后到的相同请求不得启动 |

requestId 为调用者生成的独立 UUID / 有界非空字符串，每次请求新建。probe 未选兼容接口、缺凭据或需要明确选择时可返回 Discovery.issue；HTTP / 畸形 Card / JSON / 版本等错误返回现有 AppError `{code,message,retryable,details,params}`。UI 使用自己的请求身份，项目切换 / 重复提交后不应用旧返回。

## Node 到 Rust 的 platform 请求

只能由内置 A2A 工具构造如下元信息，MCP 用户参数不能提供 URL、凭据、owner、generation 或原始远端 taskId：

```ts
interface AgentOwner {
  workspace: string;
  sessionId: string; // McpServer context 中的应用签发 ticket，不是原生历史 ID
}
interface PlatformRequest {
  api: string;
  args: [Record<string, unknown>];
  context: AgentOwner;
}
```

Rust 根据 ticket 在当前 PluginRuntime.sessions / 活动 PTY 中核查真实项目。该 ticket 本身就是一次连接 generation：关闭、撤销或重开会更换，不能从工具正文建立身份。内置 Node 工具直接使用可信 McpServer context；UI 全局 context 若使用 agentConnectionId，应先选取该 ticket，不把终端 ID 当成 ticket。无有效 Agent 连接时拒绝 Agent task API。

| API | args[0] | value |
| --- | --- | --- |
| a2a.connections | `{}` | `ConnectionInfo[]`，仅 owner 当前项目，Node 可进一步按公开白名单展示 |
| a2a.agentCard | `{ connectionId, requestId }` | `Discovery`，仅已保存连接 |
| a2a.sendMessage | `{ connectionId, requestId, text, taskHandle? }` | `TaskReply | MessageReply`；taskHandle 有值时续接本 owner 的非终态 Task |
| a2a.getTask | `{ taskHandle, requestId, historyLength? }` | `TaskReply`；historyLength 默认 0，上限 20，每次是短 GetTask，可由调用方有界轮询 |
| a2a.cancelTask | `{ taskHandle, requestId }` | `TaskReply`；真实 CancelTask，状态或 RPC 错误决定结果 |
| a2a.cancelRequest | `{ requestId }` | `boolean`；取消该 owner 的本地 HTTP，含先到取消 / 后到请求的竞态 |

platform 成功 / 失败统一 envelope，避免现有 String 宿主错误丢失 AppError 细节：

```ts
type PlatformReply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; retryable: boolean;
      details: Record<string, unknown> | null; params: Record<string, unknown> } };
interface TaskReply {
  kind: 'task';
  connectionId: string;
  taskHandle: string;
  task: Record<string, unknown>; // 远端直接 Task 经形状校验的内容
  terminal: boolean;
}
interface MessageReply {
  kind: 'message';
  connectionId: string;
  message: Record<string, unknown>;
}
```

这层宿主包装与远端 wire 分开：SendMessage 的 result 恰有 task / message 一种；GetTask / CancelTask 的 result 直接是 Task。远端 Task ID / contextId / tenant 在宿主映射中恢复，工具调用只接受 taskHandle。与连接 revision、canonical 项目和有效 Agent generation 一起检查；不是知道句柄就获得授权。

Node 工具在请求开始前监听可信 context.abort.signal，abort 时调用 a2a.cancelRequest，并在返回后再次检查 context。取消当前请求不调用远端 CancelTask；显式 A2ACancelTask 才发远端取消。取消接口不受已中断请求的局部 signal 阻挡。宿主关闭 / 会话撤销 / 连接更新或删除也中断对应 HTTP future。

## 错误、边界与验收

HTTP 401/403、RPC error、TIMEOUT、取消、无有效会话、旧 revision / 越权句柄、不支持 binding / 认证 / 必需扩展、非法响应和响应超额均明确失败。RPC error 的 details 含 rpcCode；TaskNotCancelable 的 -32002 保留。SendMessage 超时 details 包含 outcomeUnknown=true，不允许调用方据 retryable 标志自动重发。

SUBMITTED / WORKING / INPUT_REQUIRED / AUTH_REQUIRED / UNSPECIFIED 或未知状态都不是终态。只有 COMPLETED / FAILED / CANCELED / REJECTED 的完整 TASK_STATE_* 值设置 terminal=true。读取到文本、停止轮询或 HTTP 200 均不能标记任务完成。

机密 storage 测试注入临时 KeyStore，不碰用户真实 OS 凭据；不使用普通设置保存 secret。Rust 独立 HTTP fixture 验证 wire / auth / 取消；T9 Node mock 验证 owner 与接口接线。T8 / T9 不实现 Gateway、SSE、push 或 OAuth。用户最终要求完整替代并删除 Belfry 协作 Skill：T11 / T12 补本地 A2A Gateway、CLI 执行适配、显式结果报告及 Skill 迁移，保留房间 / 任务板 / 收件箱业务状态与权限；T13 验收全部最终代码，原 T10 已归档。客户端完成不能作为整体替换完成证明，完整范围见 [统一协作方案](new-feature-plan.md)。
