---
doc_type: roadmap
slug: otty-desktop
status: active
created: 2026-08-09
last_reviewed: 2026-08-09
tags: [macos, windows, terminal, ai-agent, tauri, cross-platform]
related_requirements: []
related_architecture: []
---

# OTTY Desktop

## 1. 背景

OTTY Desktop 是一套同时支持 macOS 和 Windows 的 AI 编程终端。两个平台共享 UI、领域模型、配置协议和主要 Rust 核心，同时通过独立平台适配器提供本地 Shell、窗口、通知、凭证、文件管理器和控制 IPC。

默认体验是托管 Codex、Claude Code、OpenCode 等现有 CLI Agent：OTTY 感知处理、等待输入、完成、失败和中断状态，提供通知、历史、恢复、Prompt Composer 和 Prompt Queue，但不直接调用模型 API。Agent 集成不可用时，产品必须完整退化为普通终端。为了尽早验证产品定位，在完整 Workspace 与 Agent Adapter 之前先交付“项目 + Codex/Claude 启动 + 平面会话标签”的垂直切片，避免长期停留在普通终端形态。

技术基线采用 Tauri 2 + Rust + React/TypeScript + xterm.js。最低兼容目标为 macOS 14，以及 Windows 10 22H2 Build 19045 / Windows 11。发布目标覆盖 macOS Apple Silicon/Intel 和 Windows x64/ARM64。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- macOS 的 zsh、bash、fish 与 Unix PTY。
- Windows 的 PowerShell、CMD、WSL、Git Bash 与 ConPTY。
- 两端一致的标签、分屏、会话恢复、Agent、Prompt、文件、Git、SSH、Recipe 和控制 CLI。
- 共享 TOML 配置、SQLite 状态模型、主题、快捷键语义和导入导出协议。
- macOS 的 AppKit/Dock/Keychain/Finder 集成与 Windows 的 Taskbar/Credential Manager/Explorer 集成。
- macOS 签名、公证与 DMG；Windows 签名、安装包和更新；四种 CPU/OS 发布目标。

### 明确不做

- 不支持 iOS、Android、Web 或浏览器远程版。
- 不内置模型推理客户端，不代理模型请求，不保存模型 API Key。
- 不要求两个平台逐像素相同；菜单、快捷键、窗口和系统集成遵循平台习惯。
- 不支持 macOS 14 以前或 Windows 10 22H2 以前的版本。
- 不静默提权，不自动恢复需要 sudo、Authorization Services 或 UAC 的命令。
- 不自动执行不可信的外部 Recipe；外部 Recipe 默认逐步确认。
- 不建设云同步、账号体系、团队协作、插件市场、LSP 和调试器。
- 当前仓库没有 Mac OTTY 源码，不把已安装的 Mac 二进制视为可复用实现，只作为行为参考。

## 3. 模块拆分（概设）

```text
OTTY Desktop
├── Shared UI：React、TypeScript、xterm.js 与响应式桌面布局
├── Shared Core：Workspace、Agent、Prompt、Recipe、配置与状态
├── Terminal Runtime：统一 PtyBackend 与终端字节流
├── Platform Services：macOS/Windows 原生能力适配
├── Content & Git：文件、编辑预览、SSH 与 Git
├── Navigation & Automation：Quick Open、Frecency、Recipe 与 CLI
└── Distribution：签名、安装、更新与多架构发布
```

### Shared UI

- **职责**：提供主工作台、标签/分屏、Agent 状态、Composer、设置、快速导航和内容 Pane；不直接调用 OS API。
- **承载的子 feature**：project-agent-workspace-vertical-slice, workspace-tabs-panes, settings-config-themes, prompt-composer-queue, open-quickly-command-palette, file-editor-preview-panes。
- **触碰的现有代码 / 模块**：全新。

### Shared Core

- **职责**：维护跨平台领域状态、事件、错误、持久化、Agent Adapter、恢复和 Recipe；不解释平台专属路径与窗口对象。
- **承载的子 feature**：project-agent-workspace-vertical-slice, session-persistence-restore, agent-integration-foundation, agent-history-resume, recipes-workspace-replay, import-export-parity。
- **触碰的现有代码 / 模块**：全新。

### Terminal Runtime

- **职责**：以统一接口管理 Unix PTY/ConPTY、Shell Profile、输入输出、尺寸、信号和 xterm.js 数据流；不持久化 Workspace 布局。
- **承载的子 feature**：cross-platform-terminal-vertical-slice, project-agent-workspace-vertical-slice, shell-profiles-cross-platform, terminal-interaction-compatibility, ssh-remote-integration。
- **触碰的现有代码 / 模块**：全新。

### Platform Services

- **职责**：封装通知、Dock/Taskbar、凭证、文件定位、全局快捷键、窗口材质、默认终端和本地 IPC；不包含业务状态机。
- **承载的子 feature**：agent-status-notifications, control-cli-core, desktop-native-integrations。
- **触碰的现有代码 / 模块**：全新。

### Content & Git

- **职责**：通过统一 Resource URI 浏览和编辑本地/远程文件，提供预览、Git 状态与操作；不承担完整 IDE、LSP 或调试器职责。
- **承载的子 feature**：ssh-remote-integration, file-editor-preview-panes, git-details-panel。
- **触碰的现有代码 / 模块**：全新。

### Navigation & Automation

- **职责**：聚合窗口、标签、Agent、目录、SSH 和 Recipe 的检索与动作，维护 Frecency，并提供控制 CLI。
- **承载的子 feature**：open-quickly-command-palette, recipes-workspace-replay, control-cli-core, frecency-open-recent。
- **触碰的现有代码 / 模块**：全新。

### Distribution

- **职责**：构建、签名、公证、安装、更新和多架构发布；不改变运行时领域协议。
- **承载的子 feature**：desktop-packaging-release, cross-platform-parity-hardening。
- **触碰的现有代码 / 模块**：全新。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 通用事件与错误

```text
type EntityId = string  # ULID
DomainEvent { schema_version: 1, event_id: EntityId, stream_id: EntityId,
  sequence: u64, topic: string, occurred_at: RFC3339, payload: object }
AppError { code: ErrorCode, message: string, retryable: bool, details: object | null }
ErrorCode = INVALID_ARGUMENT | NOT_FOUND | CONFLICT | UNSUPPORTED | PERMISSION_DENIED |
  PROCESS_EXITED | TIMEOUT | IO_ERROR | ADAPTER_ERROR | CONFIRMATION_REQUIRED
```

约束：`sequence` 在同一 stream 内单调递增；UI 只消费投影；未知字段必须忽略，未知 schema version 必须返回 `UNSUPPORTED`。

### 4.2 PTY 与 Terminal Session

```text
PtyBackend { spawn(CreateTerminalRequest) -> TerminalSession; write(session_id, bytes);
  resize(session_id, cols, rows); signal(session_id, interrupt | terminate | close);
  close(session_id) }
CreateTerminalRequest { platform: macos | windows, profile_id: EntityId,
  cwd: ResourceUri | null, command: string[] | null, env: map<string, string>,
  cols: u16, rows: u16, elevation: normal | request_admin }
TerminalOutputChunk { session_id: EntityId, sequence: u64, bytes: byte[], eof: bool }
```

实现：`MacPtyBackend` 使用 Unix PTY，`WindowsPtyBackend` 使用 ConPTY；二者必须通过同一 conformance suite。输出 chunk 最大 64 KiB，保持字节顺序；恢复流程不得自动提权。

### 4.3 Platform Services

```text
PlatformCapabilities { secure_keyboard_input: bool, default_terminal_registration: bool,
  window_material: none | vibrancy | mica | acrylic,
  dock_or_taskbar_progress: bool, global_hotkey: bool }
PlatformServices { capabilities() -> PlatformCapabilities; notify(NotificationRequest);
  request_attention(AgentState); reveal(ResourceUri); credential_get(key) -> Secret | null;
  credential_set(key, Secret); register_global_hotkey(KeyChord) }
```

约束：不支持的能力返回 `UNSUPPORTED`；Shared UI 不按操作系统名称分支，只按 capabilities 分支；macOS 凭证进入 Keychain，Windows 凭证进入 Credential Manager。

### 4.4 Workspace 与快捷键

```text
LayoutNode = PaneNode { pane_id } |
  SplitNode { axis: horizontal | vertical, ratio: f32, first: LayoutNode, second: LayoutNode }
KeyChord { modifiers: Primary | Alt | Shift | Control | Super, key: string }
WorkspaceSnapshot { schema_version: 1, windows: WindowSnapshot[],
  terminal_sessions: TerminalRestoreRecord[], agent_sessions: AgentSessionRecord[],
  saved_at: RFC3339 }
```

约束：`Primary` 在 macOS 映射 Command，在 Windows 映射 Ctrl；布局 ratio 为 `0.1..0.9`；平台专属快捷键可覆盖共享默认值但不得改变动作 ID。

### 4.5 Agent Adapter 与 Prompt

```text
AgentAdapter { descriptor() -> AgentDescriptor; detect(platform, context) -> DetectionResult;
  plan_install(platform, context) -> InstallPlan; apply_install(plan_id) -> InstallResult;
  normalize(raw_event) -> AgentLifecycleEvent[]; plan_resume(agent_session_id) -> ResumePlan }
AgentLifecycleEvent { agent_kind: codex | claude | opencode | other,
  agent_session_key: string, platform: macos | windows, workspace: ResourceUri | null,
  pane_id: EntityId | null, state: starting | processing | awaiting_input | completed |
  failed | interrupted, reason: string | null, occurred_at: RFC3339, metadata: object }
PromptItem { id: EntityId, agent_session_id: EntityId, content: string,
  attachments: PromptAttachment[], state: draft | queued | dispatching | sent | failed |
  cancelled, position: u32 }
```

约束：安装计划必须列出平台和修改路径并经用户确认；Adapter 不支持恢复时返回 `UNSUPPORTED`；每个 Agent Session 同时只有一个 dispatching Prompt；OTTY 不上传附件。

### 4.6 平台路径与持久化

```text
PlatformPaths { config_dir() -> Path; data_dir() -> Path; cache_dir() -> Path;
  log_dir() -> Path; runtime_dir() -> Path }
macOS config: ~/Library/Application Support/Otty/
macOS cache:  ~/Library/Caches/Otty/
Windows config: %APPDATA%\Otty\
Windows data/cache: %LOCALAPPDATA%\Otty\
```

共享文件名：`config.toml`、`state.db`、`themes/*.ottytheme`、`recipes/*.ottyrecipe`。配置使用原子替换；SQLite migration 必须事务化；日志不得记录 Prompt 正文、凭证或环境变量值。

### 4.7 本地控制协议

```text
LocalControlTransport { listen() -> ControlListener; request(ControlRequest) -> ControlResponse }
ControlRequest  { v: 1, id: EntityId, command: string, args: object }
ControlResponse { v: 1, id: EntityId, ok: bool, result: object | null, error: AppError | null }
macOS:  Unix Domain Socket，权限 0600
Windows: \\.\pipe\otty-{user_sid}，ACL 仅当前用户
```

约束：单请求最大 1 MiB；默认 30 秒超时；管理员实例使用独立 transport；协议命令与参数 schema 在两个平台完全一致。

### 4.8 Resource URI 与 Recipe

```text
ResourceUri = file:///absolute/path | ssh://profile-id/absolute/path
RecipeV1 { version: 1, name: string, platform: any | macos | windows,
  workspace: LayoutNode, steps: RecipeStep[], replay: auto | ask_once | step_by_step | skip }
```

约束：共享 Recipe 不得写平台原始路径分隔符；平台专属步骤必须声明 platform；外部 Recipe 默认 `step_by_step`；不得用不可信输入拼接 shell 命令。

### 4.9 项目工作区与早期 Agent Launcher

```text
ProjectWorkspace { id: EntityId, name: string, root_uri: ResourceUri }
AgentKind = codex | claude
AgentAvailability { kind: AgentKind, available: bool,
  executable: string | null, version: string | null, reason: string | null }
LaunchProfileId = system-default | agent:codex | agent:claude
AgentTerminalTab { id: EntityId, project_id: EntityId, kind: shell | AgentKind,
  terminal_session_id: EntityId | null, state: starting | running | exited | failed }
ProjectService.open(path: string | null) -> ProjectWorkspace
AgentLauncher.detect() -> AgentAvailability[]
TerminalRuntime.create({ profile_id: LaunchProfileId, cwd: ProjectWorkspace.root_uri, ... })
```

约束：项目路径必须规范化为存在的本地目录；Agent executable 只能来自固定 `AgentKind` 检测结果，不接受前端传入任意命令；GUI 进程未继承交互式 Shell 的 PATH 时，检测器可读取平台等价的用户命令环境；检测失败不得阻止普通 Shell；此切片的 tab 状态只代表进程生命周期，不冒充 hooks 提供的 `awaiting_input` 等语义。

## 5. 子 feature 清单

| # | Feature | 模块 | 依赖与理由 | 状态 |
|---|---|---|---|---|
| 1 | `cross-platform-terminal-vertical-slice` | Terminal / UI | 无；建立两端最窄本地 Shell 闭环 | planned |
| 2 | `project-agent-workspace-vertical-slice` | Shared UI/Core / Terminal | 与 1 并行复用已落地 PTY 契约；提前验证项目级 Agent 产品闭环 | planned |
| 3 | `shell-profiles-cross-platform` | Terminal | 1 提供 PTY Session 和 Profile 启动入口 | planned |
| 4 | `terminal-interaction-compatibility` | Terminal / UI | 1 提供稳定字节流和渲染面 | planned |
| 5 | `workspace-tabs-panes` | Shared UI/Core | 2 提供项目与平面标签模型，扩展为递归 Pane | planned |
| 6 | `settings-config-themes` | UI/Core | 1 提供设置应用目标和终端预览 | planned |
| 7 | `session-persistence-restore` | Shared Core | 5、6 提供稳定布局与配置 schema | planned |
| 8 | `agent-integration-foundation` | Shared Core | 2、5、7 提供早期 Launcher、Pane 绑定和持久会话身份 | planned |
| 9 | `codex-agent-adapter` | Agent | 8 提供 Adapter 与生命周期契约 | planned |
| 10 | `agent-status-notifications` | Agent/Platform | 8、9 提供标准事件和首个真实数据源 | planned |
| 11 | `prompt-composer-queue` | UI/Core | 5、8 提供目标 Pane 与 Agent Session | planned |
| 12 | `agent-history-resume` | Agent/Core | 7、8、9 提供存储、恢复契约和实现样本 | planned |
| 13 | `open-quickly-command-palette` | Navigation | 5、7、8 提供统一可搜索状态 | planned |
| 14 | `claude-agent-adapter` | Agent | 8 提供 Adapter 契约 | planned |
| 15 | `opencode-agent-adapter` | Agent | 8 提供 Adapter 契约 | planned |
| 16 | `ssh-remote-integration` | Terminal/Content | 3、4、7 提供 Profile、终端兼容和恢复 | planned |
| 17 | `file-editor-preview-panes` | Content/UI | 5、6 提供 Pane 布局和编辑器设置 | planned |
| 18 | `git-details-panel` | Content/Git | 16、17 提供远程资源访问和内容展示 | planned |
| 19 | `recipes-workspace-replay` | Navigation/Core | 5、6、7、8 提供布局、配置、恢复和 Agent | planned |
| 20 | `control-cli-core` | Control/Platform | 5、8 提供可控制领域对象和 hook 入口 | planned |
| 21 | `frecency-open-recent` | Navigation | 7、13、20 提供历史、搜索 UI 和 CLI | planned |
| 22 | `import-export-parity` | Core/Navigation | 6、19 提供稳定配置与 Recipe schema | planned |
| 23 | `desktop-native-integrations` | Platform | 6、10、20 提供设置、通知和 CLI 注册目标 | planned |
| 24 | `desktop-packaging-release` | Distribution | 22、23 提供完整文件关联和平台集成 | planned |
| 25 | `cross-platform-parity-hardening` | 跨模块 | 依赖全部用户能力，负责最终双平台验收 | planned |

**最小闭环**：`project-agent-workspace-vertical-slice` 完成后，用户可打开本地项目、看到 Codex/Claude 可用性并在项目目录启动多个 Agent 或 Shell 标签；Agent 不可用时仍可使用普通终端。

## 6. 排期思路

1. 在已有 PTY 基础上先交付项目级 Codex/Claude Launcher 产品闭环。
2. 补齐双平台 Shell、终端交互、递归 Workspace、设置和恢复。
3. 把早期 Launcher 升级为 Agent Adapter、状态通知、Composer、历史与导航。
4. 扩展 Claude hooks、OpenCode、SSH、文件编辑和 Git。
5. Recipes、CLI、Frecency、导入导出和原生平台集成。
6. 双平台签名发布、无障碍、性能、稳定性和能力对照验收。

第一条必须同时通过 macOS 和 Windows 验证；任何只在单平台工作的实现都不能完成该 feature。技术依赖之外的同阶段顺序可通过 roadmap update 调整。

## 7. 观察项

- 当前没有 requirement 文档；进入首个 feature-design 前建议用 `cs-req draft` 固化跨平台用户价值和成功标准。
- 当前 architecture 只有空骨架；实际模块只能在 feature 验收后回写。
- 已安装 Mac OTTY 1.3.1 可作为行为基线，但当前仓库没有其源码，不能假设可以直接迁移实现。
- xterm.js 是首发共享渲染器，PtyBackend 与 Terminal Runtime API 必须保持渲染器无关。
- macOS 和 Windows 的 Agent hooks 安装路径、恢复命令与权限需要逐 Adapter 验证，不允许用单平台假设填充另一端。
- Windows-only roadmap `otty-windows` 已暂停，所有条目保持 planned，不再启动 feature。
- `cross-platform-terminal-vertical-slice` 已有 macOS 运行证据但仍缺 Windows 真机证据；项目级 Agent 切片可并行开发，二者的 Windows 验收都不能由交叉编译替代。

## 8. 变更日志

- 2026-08-09：根据产品反馈新增 `project-agent-workspace-vertical-slice`，把最小闭环从“普通终端可运行”调整为“项目中可启动 Codex/Claude/Shell 多会话”；新增项目与早期 Agent Launcher 共享契约，后续 Workspace 与 Agent Adapter 依赖该早期模型演进。
