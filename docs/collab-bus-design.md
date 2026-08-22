# 多 Agent 协作总线 · 设计

> 状态：设计稿，待评审。前置 P1（共享上下文）已交付并端到端验证。
> 目标：让不同 Agent 会话**相互指挥**，且新接入的 Agent 无需改协作层代码。

---

## 0. 一句话

给每个 Agent 会话发一张身份牌和一个能敲的命令（`belfry`），
让它能对别的会话说「你去做这个」，并在做完时**自己声明**做完了。

---

## 1. 三个已定型的前提

来自设计阶段的结论，此处只复述结论与理由，不再论证。

| # | 决策 | 理由 |
|---|---|---|
| 1 | 主通道是 **shell 命令**，不是 MCP | CLI agent 的最小公分母是「能跑 shell」，不是「支持 MCP」。选 MCP 会把非 MCP 的 agent 挡在门外 |
| 2 | 完成必须由 agent **显式声明** | `structuredState: false`，`activity` 是扫屏幕猜的。拿猜测当串行编排的同步原语＝把幻觉当锁 |
| 3 | **不新建执行引擎**，复用 `PromptQueueRuntime` | 它已解决串行派发、等 `running+idle`、权限框暂停、重挂回滚不丢指令 |

---

## 2. 技术前提（已验证）

设计成立依赖四个事实，都已在代码里核对过：

1. **env 链路是通的。** `CreateTerminalRequest.env` → `resolve_launch` → `configured_command`
   → `command.env(k, v)` → PTY（`src-tauri/src/terminal/launch.rs:366-377`）。
   前端目前传 `env: {}`（`src/terminal/contracts.ts`），**通道存在但没人用**。
   → 身份注入不需要新机制，填这个字段即可。

2. **PATH 已经在被管理。** macOS 侧 `agent_command` 会补 `user_command_path()`
   （`launch.rs:380-388`）。→ 可以在同一处把 CLI 目录 prepend 进 PATH。

3. **不是 Cargo workspace。** 只有 `src-tauri/` 单 crate。→ 加 CLI 要先建 workspace。

4. **Windows 的 `.cmd`/`.bat` 启动已有处理**（`launch.rs:391-396`）。
   → CLI 在 Windows 上的 shim 有先例可循。

---

## 3. 架构

```
┌─ Agent A 的 PTY ─────────┐        ┌─ Belfry (Tauri app) ──────────────┐
│ env:                     │        │                                    │
│   BELFRY_TAB_ID=t1       │        │  ┌── IPC Server ──┐                │
│   BELFRY_TOKEN=<一会话一份>│       │  │ uds / named pipe│               │
│   PATH=<cli 目录>:$PATH  │        │  └────────┬────────┘                │
│                          │        │           │ 鉴权 (tabId+token)      │
│  $ belfry send --to      │───────▶│           ▼                        │
│      reviewer "审这段"    │  IPC   │      CollabBus                     │
│                          │        │   ├ 寻址解析 (角色/tab/agent)        │
│  $ belfry done --task X  │───────▶│   ├ 安全闸门 (hop/环/预算/权限)      │
└──────────────────────────┘        │   └ 投递 ─────────┐                │
                                    │                   ▼                │
┌─ Agent B 的 PTY ─────────┐        │        PromptQueueRuntime          │
│                          │◀───────│   (串行 / 等 idle / 重挂回滚)       │
│  「[belfry] 来自 A 的任务 │ 注入   │                                    │
│    …正文…                │        │        ContextStore (.belfry/)      │
│    完成后敲 belfry done」 │        └────────────────────────────────────┘
└──────────────────────────┘
```

**关键：投递不绕过 Prompt Queue。** 协作任务和用户手敲的 prompt 走同一条队列、
同一套 `canDispatchPrompt` 门禁。这意味着 agent 弹权限框时协作自然暂停，
终端重挂时任务自动回滚重发——这些语义全是白拿的。

---

## 4. 控制 CLI

### 4.1 分发：零安装

CLI 二进制随 app 打包，**不装进系统 PATH**，而是在启动 PTY 时把它所在目录
prepend 进那个终端的 `PATH`。

```
命中范围：Belfry 开的终端里 `belfry` 可用
系统其他地方：没有这个命令，也不改用户的 shell 配置
app 退出：什么都不残留
```

理由：装进 `/usr/local/bin` 要提权（README 明确「不做静默提权」），
写 `.zshrc` 是改用户的家当。而我们本来就完全控制 PTY 的 env——这是最小侵入的位置。

代价：用户在 Belfry 之外的终端里敲 `belfry` 不认。可接受——它本来就只在
Belfry 托管的会话里有意义（没有 `BELFRY_TAB_ID` 就没有身份）。

### 4.2 工程结构

```
Cargo.toml                     ← 新建 workspace
crates/belfry-protocol/        ← 请求/响应类型，app 与 cli 共用，避免两边手抄
crates/belfry-cli/             ← 产出 `belfry` 二进制
src-tauri/                     ← 现有 app，依赖 belfry-protocol
```

CLI 必须**薄**：解析参数 → 连 socket → 发 JSON → 打印响应。
所有判断留在 app 侧。理由：CLI 会被打进安装包，改它要发版；app 侧逻辑可以随
热更新迭代。

### 4.3 命令面

```bash
belfry peers                          # 现在有哪些会话、各自什么状态
belfry send --to <目标> <指令>          # 派活（默认异步，--wait 阻塞等完成）
belfry done --task <id> [--result <文件>]  # 我做完了
belfry fail --task <id> --reason <原因>    # 我做不了
belfry ctx list|get|put               # 读写共享上下文（P1 已有存储层）
```

`--to` 三种寻址，按优先级：

1. **角色名**（`reviewer`）——用户给会话打的标签。**首选**：prompt 里不写死
   「发给 claude」，换 agent 不用改剧本
2. tab 标题
3. agent 类型（`claude` / `codex`）——最后手段，多个同类会话时不确定

### 4.4 IPC

| 平台 | 通道 | 路径 |
|---|---|---|
| macOS / Linux | Unix domain socket | `$XDG_RUNTIME_DIR` 或 `$TMPDIR/belfry-<uid>.sock`，权限 `0600` |
| Windows | Named pipe | `\\.\pipe\belfry-<sid>` |

单行 JSON 请求 / 单行 JSON 响应，然后关闭。不做长连接——
`--wait` 靠轮询或服务端 hold 住响应，前者更简单，先做前者。

---

## 5. 身份与鉴权

启动 Agent 会话时注入：

```
BELFRY_TAB_ID=<tabId>
BELFRY_TOKEN=<每会话一份的随机串>
BELFRY_PROJECT=<项目根绝对路径>
```

CLI 每次请求带上 `tabId + token`，app 侧比对。

**为什么要 token 而不只是 tabId**：tabId 会出现在日志、截图、agent 的上下文里。
只认 tabId 的话，agent A 把 `--to` 换成别人的 id 就能**冒充别人发指令**。
token 不出现在任何输出里，只活在 env。

**token 生命周期**：会话创建时生成，会话关闭即失效。PTY 重启（generation++）
重新生成——旧 token 立刻作废。

---

## 6. 协作任务模型

```rust
struct CollabTask {
    id: TaskId,
    from: TabId,              // 谁派的
    to: TabId,                // 派给谁（寻址已解析）
    instruction: String,
    state: TaskState,
    hop: u8,                  // 第几手转包
    path: Vec<TabId>,         // 完整调用链，用于环检测
    run_id: Option<RunId>,    // 归属的协作轮次
    result: Option<String>,   // 产物路径或摘要
    created_at: i64,
}

enum TaskState {
    Queued,      // 在 Prompt Queue 里等目标空闲
    Dispatched,  // 已注入目标终端，等它干活
    Done,        // 目标敲了 belfry done —— 唯一可信的完成信号
    Failed,      // 目标敲了 belfry fail
    Abandoned,   // 目标会话没了 / 用户中止 / 超时
}
```

**`Dispatched → Done` 只能由 `belfry done` 触发。**
屏幕启发式（`activity` 回 idle）只用于**提示**「它可能忘了敲 done」，
绝不自动置为 Done。UI 上区分：

- `Done` → 「已完成」（agent 自己说的）
- `Dispatched` + 长时间 idle → 「已送达，完成情况未知」

这条规矩 Recipe 已经立了（`RecipeStepStatus` 刻意没有 `completed`），协作接着守。

### 注入文本格式

必须**极简**——每个字都占目标 agent 的上下文，还会污染它的对话。

```
[belfry] 来自「<角色或标题>」的任务 <短id>
<指令正文>
完成后执行：belfry done --task <短id>
```

三行封装。不做「入职说明」「工具清单」这类一次性铺垫——
那些属于 agent 自己的 system prompt，不是我们该塞的。

---

## 7. 安全闸门（不可省）

项目**已经在用 `--dangerously-skip-permissions` 启动 Claude**
（`src-tauri/src/agent/adapter.rs:216`）。agent 能互相派活 + 跳过权限确认，
放大效应是真实的：一次误判可能变成一串会话连锁执行。

| 闸门 | 默认 | 作用 |
|---|---|---|
| **权限模式** | `ask` | 每条跨会话指令弹确认。另有 `auto-in-project` / `off` |
| **跳数上限** | 3 | A→B→C→D 就停。防无限转包 |
| **环检测** | 开 | `path` 里已有目标就拒。防 A→B→A |
| **每轮消息预算** | 20 | 超了整轮停 |
| **一键全停** | — | 比什么都重要。UI 常驻 |
| **跨项目** | 禁 | 只能派给同项目的会话 |

默认 `ask` 符合项目取向：不静默做危险的事。熟悉之后用户可自行放开。

**另需修一个现存 bug**（协作场景下代价更大）：
`src/recipe/useRecipes.ts:103` 的 `RUN_HISTORY_LIMIT = 8`，
第 9 轮把旧轮挤出 `runs` 时**没调 `removeRun`**——队列项还在继续派发，
但 UI 已经没有卡片能中止它。协作会让这种「失控孤儿任务」更难发现。

---

## 8. Agent 开放化

用户要求「以后接入其他 agent 无缝」。当前 `AgentKind = "codex" | "claude"`
是闭合联合，Rust 侧是 enum + `adapter_for` 的 match。

**但真正的「无缝」不是把类型改宽，而是协作层不依赖具体取值。**

规矩（已在 P1 的 `src/collab/` 落实）：

> collab 层永不比较 agent 取值（不写 `kind === "claude"`），只读 capabilities。

据此扩 capabilities：

```ts
interface AgentCapabilities {
  launch, resume, history, prompt, structuredState  // 现有
  collab: boolean;          // 能参与协作（≈ 能跑 shell 命令）
  nonInteractive: boolean;  // 能 headless 跑一次性任务
  mcp: boolean;             // 支持 MCP → 走原生 tool call 增强通道
}
```

类型开放化（`AgentKind` → `AgentId = string`，`adapter_for` → registry）
可以延后，因为协作层已经不依赖它。**接入第 4 个 agent 的成本目标：
写一个 adapter + 注册一行，协作层零改动。**

---

## 9. 分期

| 期 | 内容 | 可独立交付的价值 |
|---|---|---|
| **P2a** | Cargo workspace + `belfry-protocol` + `belfry-cli` 骨架 + IPC server + 身份注入 + `belfry peers` / `belfry ctx` | ✅ Agent 能读写共享上下文——P1 的能力对 agent 开放 |
| **P2b** | PATH 注入 + 打包（externalBin）+ Windows shim | ✅ 零安装可用 |
| **P3a** | `send` / `done` / `fail` + CollabTask + 投递进 Prompt Queue | ✅ 相互指挥跑通 |
| **P3b** | 安全闸门全套 + 一键全停 | ✅ 敢开给真实项目用 |
| **P3c** | 协作视图（会话拓扑 + 任务时间线）+ 跨会话通知 | ✅ 看得见谁在等谁 |
| **P4** | 角色标签、`--wait`、多目标 Recipe、MCP 增强通道、`history_read` 摘要入料 | 增强 |

**P2a 是最小可验证切片**：不涉及派活，只让 agent 能通过 CLI 读写上下文。
一旦它跑通，IPC + 身份 + CLI 分发三件事就都验证过了，P3 只是加命令。

---

## 10. 未决

1. **`.belfry/` 位置**：P1 已按「项目内 + 提示加 .gitignore」实现。
   改应用数据目录的话现在成本最低（只动 `store.rs` 的 `context_dir()`）。
2. **`--wait` 的实现**：轮询 vs 服务端 hold。倾向先轮询，简单且不占连接。
3. **角色标签存哪**：会话属性（跟着 tab 走，重启即失）还是项目配置
   （持久，但要处理会话与角色的绑定漂移）。
4. **CLI 版本不匹配**：app 升级但用户的终端还开着旧 CLI 进程。
   协议里带版本号，不匹配时 CLI 打印提示而不是静默行为异常。

---

## 11. 风险

1. **控制 CLI 是全新分发面**，也是最大工程成本：打包、Windows shim、
   版本兼容。但它换来「任何能跑 shell 的 agent 都能接入」，值这个价。
2. **注入 prompt 污染 agent 上下文**并吃 token。协议头必须锁死在 3 行内。
3. **agent 可能不听话**：不敲 `done`、乱敲 `send`。所以闸门默认 `ask`，
   且 UI 必须如实显示「已送达，完成情况未知」而不是假装完成。
4. **「协作」一词有歧义**：README 的「明确不做」里写着**团队协作**。
   本设计全在本机单用户内，不违背，但对外措辞要把
   「多 Agent 协作」和「多人协作」明确切开。
