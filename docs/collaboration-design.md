# 多 Agent 协作设计

## 目标

多 Agent 协作是一次由协调 Agent 统筹的目标执行运行（Run）：

1. 用户只提交一个整体目标，不填写任务列表。
2. 协调 Agent 读取项目并自动将目标拆成任务。
3. 多个 Worker Agent 在独立工作区中并行执行互不冲突的任务。
4. Worker 可以在执行中申请子 Agent，承担更细的子任务。
5. 子任务结果、产物和问题逐级回流，最终由协调 Agent 汇总。

Agent 之间不共享一个混合聊天上下文，也不直接修改同一个主工作区。协作的基本单位是任务、产物和结构化事件。

## 层级

```text
协调 Agent（Coordinator）
├── Worker A
│   ├── Worker A-1
│   └── Worker A-2
├── Worker B
└── Reviewer / Verifier
```

- Coordinator 是每个 Run 唯一的根 Agent，负责计划、分配、收集和汇总。
- Worker 独立负责一个任务，可以申请子 Agent，但不能创建新的 Coordinator。
- 子 Agent 只负责自己的任务，不能修改父任务或其他任务的状态。
- 父任务在所有子任务验收前不能标记为 accepted。

## 并发

任务进入 `ready` 后，调度器会检查：

- 依赖是否全部 `accepted`。
- 是否达到 Run 的最大并发数。
- 声明修改的路径是否与活动任务冲突。
- 是否已经分配独立工作区。

满足条件的多个任务可以同时进入 `leased` / `running`。并发是调度器的决定，Agent 不能绕过调度器直接启动工作进程。

## 动态创建 Agent

Run 启动时没有预置任务。Coordinator 在收到目标后先进行只读分析，然后为拆出的每个任务直接提交 Spawn 请求，因此任务列表、负责人和 Agent 会话都由 Agent 自动产生。

Worker 通过结构化 Spawn 请求表达“需要一个子 Agent”：

```ts
{
  requestedByAgentId: "worker-a",
  parentTaskId: "task-a",
  title: "补充 API 测试",
  objective: "为登录接口补充边界测试",
  role: "worker",
  providerId: "claude",
  claimedPaths: ["tests/auth"],
  acceptanceCriteria: ["覆盖过期 token", "测试通过"]
}
```

协调层负责：

- 校验请求者身份和父任务。
- 检查最大 Agent 数量。
- 检查最大创建深度。
- 检查每个 Agent 的子 Agent 数量。
- 根据策略自动批准或等待人工批准。
- 创建新会话、独立工作区和对应任务。
- 将任务 Manifest 发送给新 Agent。

默认策略可以自动创建，但必须有硬上限：

```text
maxAgents = 8
maxSpawnDepth = 2
maxChildrenPerAgent = 6
maxConcurrency = 4（可按 Run 设置为 1、2、3、4 或 6）
```

## 状态

### Agent 状态

```text
starting → idle → running → completed
                  ├── blocked
                  ├── failed
                  └── cancelled
```

### Task 状态

```text
pending → ready → leased → running → submitted → reviewing → accepted
                                    ├── blocked
                                    ├── failed
                                    └── cancelled
```

`submitted` 只表示 Agent 提交了结果，不表示结果已经被认可。Review、验证和父任务收敛是独立步骤。

## 任务交接

每个任务收到一个 Manifest：

- Run ID、Task ID、Agent ID
- 任务目标和验收标准
- 独立工作区路径
- 上游已确认产物
- 允许使用的能力和路径

Agent 提交 `TaskResult`：

- 摘要
- 修改文件
- Artifact 列表
- 测试结果
- 未解决的问题

下游 Agent 只读取已确认的 Artifact，不读取其他 Agent 的临时终端输出。

## 协调 Agent 汇总

协调层生成结构化 `CoordinationSummary`，包含：

- Run 目标和状态
- 任务总数、已验收数
- 活动和已完成 Agent 数量
- 每个任务的状态、父任务和结果摘要
- 所有 Artifact 引用
- 所有未解决问题

该摘要发送给 Coordinator Agent，由它生成最终结论。最终结论必须区分：

- 已完成并验证的内容
- 已提交但尚未验证的内容
- 阻塞、失败和需要用户决策的内容

## 安全边界

- Agent 不能直接创建系统进程，必须提交 Spawn 请求。
- 主工作区不直接交给 Worker 写入。
- 每个写任务使用独立工作区。
- 同一路径的活动任务不能并发。
- 路径冲突按文件和目录的祖先关系判断，例如 `src` 与 `src/ui` 也不能并发；调度器在同一批 ready 任务中会再次做两两筛选。
- 达到数量、深度、并发或重试上限时，Run 进入可解释的阻塞状态。
- 用户可以随时停止 Run，协调层会停止所有活动会话；停止后的 Run 不支持原地续跑，需要新建 Run。

## 事件与并发边界

- Agent 的原生 JSONL 会话日志是结构化事件的主来源；PTY 屏幕输出只作为低延迟备用来源。全屏 TUI 会插入 ANSI、换行和重绘，不能再作为唯一协议通道。
- 每个 Agent 首条消息都会注入唯一的 `otty-collab-session:<runId>:<agentId>` marker。后端只读取该 marker 之后的 assistant 消息，忽略 user/tool 内容，防止任务说明里的示例帧被误执行。
- JSONL 按文件路径和字节 offset 增量读取；不推进未写完的行，日志截断后会重新定位 marker，并拒绝读取 Provider 会话根目录之外的路径。
- 每个终端会话独立维护 PTY 协议缓冲区，支持跨输出块的 `<otty-collab>` 帧；已解析帧不会留在 remainder 中再次执行。
- 两个事件源统一按 `agentId + payload` 去重，因此同一 Spawn 或 TaskResult 即使同时出现在日志和终端中也只执行一次。
- 同一终端的多个协议帧按顺序处理；全局 ready 调度也串行化，避免多个回传同时触发重复领取。
- 协议运行时带 Run generation。清空或创建新 Run 后，旧日志轮询和旧队列的迟到结果会被丢弃，不会写入新 Run。
- Run 进入 `failed` 或 `cancelled` 后不再派发新任务；只有显式重试才会恢复为可派发状态。
- 带人工审批的 Spawn 会预留 Agent 和子 Agent 配额，防止等待审批的请求绕过上限。
- 终端回传属于不可信输入，结构化结果中的 Artifact 和测试条目会先做类型归一化。

## 协作专用 Agent 会话

- 默认不复用当前普通 Agent，而是新建独立 Coordinator 终端；用户仍可在高级设置中显式选择已有 Agent Tab。
- Coordinator 和 Worker 的新终端都会标记 `collaborationMode=true`，沿工作区、TerminalStage、前端请求传到 Rust PTY 启动器。
- Codex 协作会话前置 `--disable multi_agent`；Claude Code 协作会话前置 `--disallowedTools Agent Task`。这样 Provider 自带的子 Agent 不会绕过 Otty 的任务列表、并发限制、工作区隔离和结果汇总。
- Codex 协作会话额外使用独立的 `CODEX_SQLITE_HOME` 临时目录，避免宿主权限或损坏的用户状态库让协作终端在启动阶段退出；配置、认证和 JSONL 会话日志仍使用用户原有的 `CODEX_HOME`。
- 普通 Agent、Shell 和 SSH 启动参数保持原样；Rust 会拒绝在非 Agent profile 上开启 collaboration mode。
- 如果 25 秒内仍未收到 Coordinator 的 Spawn 帧，控制台显示规划超时，并允许重新注入 Coordinator 指令。

## 当前实现边界

`src/collaboration/` 已提供 P0 领域内核：

- Run、Task、Agent Session、Spawn Request、Artifact 和事件契约
- DAG 校验和就绪任务计算
- 并发调度、路径冲突和独立工作区校验
- 动态 Spawn、层级限制和审批模式
- Fake Executor 和 Fake Session Factory
- Coordinator 汇总

真实 Tauri/PTY 接入通过 `TerminalAgentSessionFactory` 和 `TauriWorkspaceAllocator` 完成：

- Coordinator 默认自动创建协作专用 Provider 会话；只有用户在高级设置中明确选择时才复用已有 Agent Tab。
- Worker 由调度器按并发上限创建独立 Tab，启动前通过 `git worktree add --detach` 分配隔离目录。
- 用户只需输入 Run 目标；Coordinator 自动分析项目并通过 Spawn 创建初始 Worker。活动任务声明同一文件或父子目录时不会并发领取。
- Manifest 通过终端输入发送；Spawn 请求和 TaskResult 由 JSONL 主通道与 PTY 备用通道共同接收，不新增聊天窗口。
- Worker 输出 `task_result` 后进入提交、审查和验收流程；Coordinator 收到结构化汇总后继续调度。
- 用户可以在控制台验收、要求修改、重试、批准 Spawn 或停止 Run。

调度器不依赖具体 Provider。Git worktree 会保留在项目同级的 `.项目名-otty-workspaces/<run>/<task>`，便于查看和回收；后续可增加 Run 级清理策略。
