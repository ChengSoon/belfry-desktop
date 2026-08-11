---
doc_type: roadmap
slug: belfry-windows
status: paused
created: 2026-08-09
last_reviewed: 2026-08-09
tags: [windows, terminal, ai-agent, tauri, conpty]
related_requirements: []
related_architecture: []
---

# BELFRY Windows

> **已暂停**：2026-08-09 用户纠正目标平台为 macOS + Windows。本文件保留为早期 Windows-only 规划记录，不再作为当前执行来源；后续由 `belfry-desktop` roadmap 接替。

## 1. 背景

BELFRY 当前只有 Mac 版本，需要从零开发 Windows 版本。产品终态覆盖 Mac BELFRY 的完整能力，但不逐像素复制 macOS；Windows 版保留同等功能、工作流和配置语义，同时遵循 Windows 的窗口、快捷键、通知、权限和视觉习惯。

默认体验是 AI 编程终端：BELFRY 托管 Codex、Claude Code、OpenCode 等现有 CLI Agent，通过 hooks 或插件感知生命周期，提供状态、通知、历史、恢复和 Prompt 调度。终端始终是主要工作区域；Agent 集成不可用时必须退化为普通终端。

技术基线采用 Tauri 2 + Rust + React/TypeScript。终端进程由 Rust 侧通过 ConPTY 管理，终端内容由 xterm.js 渲染；SQLite 保存运行状态，TOML 保存用户配置，Windows 原生能力通过 Rust 平台桥接提供。最低兼容目标为 Windows 10 22H2 Build 19045，同时支持 Windows 11；Windows 11 可启用 Mica，Windows 10 使用不透明 Fluent 主题降级。

## 2. 范围与明确不做

### 本 roadmap 覆盖

- PowerShell、CMD、WSL、Git Bash、SSH 等 Shell 和远程环境。
- 多窗口、标签、分屏、文件浏览、编辑预览、Git 和会话恢复。
- Codex、Claude Code、OpenCode CLI Agent 的检测、集成、状态与恢复。
- Prompt Composer、Prompt Queue、Open Quickly、Command Palette、Frecency 和 Recipes。
- 图形设置、TOML 配置、主题、快捷键、控制 CLI、安装更新和 Windows 系统集成。
- Windows 10/11、x64/ARM64、无障碍、性能、稳定性和 Mac 能力对照验收。

### 明确不做

- 不内置模型推理客户端，不代理模型请求，不保存模型 API Key。
- 不逐像素复制 macOS，不机械映射 Cmd/Option 等平台键位。
- 不支持 Windows 10 22H2 以前的系统版本。
- 不静默绕过 UAC，不自动恢复需要管理员权限的命令。
- 不自动执行不可信的外部 Recipe；外部 Recipe 默认逐步确认。
- 不建设云同步、账号体系、团队协作、插件市场、语言服务器和调试器。
- 不在本 roadmap 中重写现有 Mac BELFRY，也不承诺两端共用同一套 UI 代码。

## 3. 模块拆分（概设）

```text
BELFRY Windows
├── Desktop Platform：桌面外壳、窗口和 Windows 系统集成
├── Terminal Runtime：ConPTY、Shell Profile、终端 I/O 与渲染桥接
├── Workspace Runtime：窗口、标签、Pane、分屏和布局状态
├── Persistence & Config：SQLite、TOML、日志、主题和数据迁移
├── Agent Runtime：Agent Adapter、生命周期、历史与恢复
├── Prompt Workflow：Composer、Queue、上下文和终端派发
├── Content & Git：文件浏览、编辑预览、Git 和远程资源
├── Navigation & Recipes：快速导航、Frecency、Recipe 与重放
└── Control Plane：belfry CLI、Named Pipe、单实例和外部控制
```

### Desktop Platform

- **职责**：承载 Tauri 窗口、系统标题栏、任务栏、通知、文件关联、安装更新和 Windows 10/11 视觉降级；不实现终端协议和 Agent 业务状态。
- **承载的子 feature**：terminal-vertical-slice, agent-status-notifications, windows-integration-packaging, parity-accessibility-performance。
- **触碰的现有代码 / 模块**：全新。

### Terminal Runtime

- **职责**：管理 ConPTY 生命周期、Shell Profile、输入输出、尺寸、信号、终端能力和 xterm.js 数据流；不保存 Workspace 结构。
- **承载的子 feature**：terminal-vertical-slice, shell-profiles-wsl, terminal-interaction-compatibility, ssh-remote-integration。
- **触碰的现有代码 / 模块**：全新。

### Workspace Runtime

- **职责**：维护窗口、标签、Pane、分屏树、焦点和可恢复布局；不解释终端字节流。
- **承载的子 feature**：workspace-tabs-panes, session-persistence-restore。
- **触碰的现有代码 / 模块**：全新。

### Persistence & Config

- **职责**：管理 TOML 配置、SQLite 状态、会话日志、主题、导入导出和 schema migration；不决定 UI 展示方式。
- **承载的子 feature**：settings-config-themes, session-persistence-restore, import-export-parity。
- **触碰的现有代码 / 模块**：全新。

### Agent Runtime

- **职责**：通过 Adapter 检测 Agent、安装集成、归一化事件、维护状态、历史与恢复计划；不直接调用模型服务。
- **承载的子 feature**：agent-integration-foundation, codex-agent-adapter, claude-agent-adapter, opencode-agent-adapter, agent-status-notifications, agent-history-resume。
- **触碰的现有代码 / 模块**：全新。

### Prompt Workflow

- **职责**：编辑 Prompt、管理队列、引用本地上下文并向目标终端派发输入；不上传文件或调用模型 API。
- **承载的子 feature**：prompt-composer-queue。
- **触碰的现有代码 / 模块**：全新。

### Content & Git

- **职责**：以统一资源 URI 浏览和编辑本地/远程文件，提供预览、Git 状态与操作；不承担完整 IDE、LSP 或调试器职责。
- **承载的子 feature**：file-editor-preview-panes, git-details-panel, ssh-remote-integration。
- **触碰的现有代码 / 模块**：全新。

### Navigation & Recipes

- **职责**：聚合窗口、标签、Agent、目录、SSH 和 Recipe 的搜索与动作，维护 Frecency，并安全重放 Workspace Recipe。
- **承载的子 feature**：open-quickly-command-palette, frecency-open-recent, recipes-workspace-replay。
- **触碰的现有代码 / 模块**：全新。

### Control Plane

- **职责**：提供同用户范围的单实例控制面、Named Pipe 协议和 belfry CLI；不向其他用户或网络暴露控制端口。
- **承载的子 feature**：control-cli-core, windows-integration-packaging。
- **触碰的现有代码 / 模块**：全新。

## 4. 模块间接口契约 / 共享协议（架构层详设）

### 4.1 通用标识、事件与错误

**方向**：所有模块共享
**形式**：Rust 类型与 TypeScript 镜像类型

```text
type EntityId = string  # ULID，小写 Crockford Base32

DomainEvent {
  schema_version: 1,
  event_id: EntityId,
  stream_id: EntityId,
  sequence: u64,
  topic: string,
  occurred_at: RFC3339,
  payload: object
}

AppError {
  code: INVALID_ARGUMENT | NOT_FOUND | CONFLICT | UNSUPPORTED |
        PERMISSION_DENIED | PROCESS_EXITED | TIMEOUT | IO_ERROR |
        ADAPTER_ERROR | CONFIRMATION_REQUIRED,
  message: string,
  retryable: bool,
  details: object | null
}
```

**约束**：`sequence` 在同一 `stream_id` 内单调递增；UI 只消费投影，不自行生成领域状态；未知事件字段必须忽略，未知 `schema_version` 必须返回 `UNSUPPORTED`。

### 4.2 Terminal Runtime API

**方向**：Workspace / Control Plane → Terminal Runtime；Terminal Runtime → UI / Persistence
**形式**：Tauri command + 有序 Channel

```text
CreateTerminalRequest {
  profile_id: EntityId,
  cwd: string | null,
  command: string[] | null,
  env: map<string, string>,
  cols: u16,
  rows: u16,
  elevation: normal | request_admin
}

TerminalSession {
  id: EntityId,
  profile_id: EntityId,
  cwd: string,
  process_name: string,
  cols: u16,
  rows: u16,
  elevation: normal | admin,
  status: starting | running | exited | failed,
  exit_code: i32 | null
}

create_terminal(request) -> TerminalSession
write_terminal(session_id, bytes) -> void
resize_terminal(session_id, cols, rows) -> void
signal_terminal(session_id, interrupt | terminate | close) -> void
close_terminal(session_id) -> void

TerminalOutputChunk {
  session_id: EntityId,
  sequence: u64,
  bytes: byte[],
  eof: bool
}
```

**约束**：单个输出 chunk 不超过 64 KiB；保持字节顺序，不按字符串边界切分；`request_admin` 必须触发系统 UAC；恢复流程不得自动请求管理员权限。

### 4.3 Workspace Layout

**方向**：Workspace Runtime ↔ Persistence / UI / Recipes
**形式**：共享数据结构

```text
LayoutNode =
  PaneNode { pane_id: EntityId } |
  SplitNode {
    axis: horizontal | vertical,
    ratio: f32,
    first: LayoutNode,
    second: LayoutNode
  }

WorkspaceSnapshot {
  schema_version: 1,
  windows: WindowSnapshot[],
  terminal_sessions: TerminalRestoreRecord[],
  agent_sessions: AgentSessionRecord[],
  saved_at: RFC3339
}
```

**约束**：`ratio` 必须在 `0.1..0.9`；每个 `pane_id` 在一棵布局树中只出现一次；读取损坏节点时保留其余可恢复 Pane 并记录 `IO_ERROR`。

### 4.4 Agent Adapter 与生命周期

**方向**：Agent Adapter → Agent Runtime → Workspace / Notifications / Prompt Workflow
**形式**：Rust trait + 归一化事件协议

```text
AgentAdapter {
  descriptor() -> AgentDescriptor
  detect(context) -> DetectionResult
  plan_install(context) -> InstallPlan
  apply_install(plan_id) -> InstallResult
  normalize(raw_event) -> AgentLifecycleEvent[]
  plan_resume(agent_session_id) -> ResumePlan
}

AgentLifecycleEvent {
  schema_version: 1,
  event_id: EntityId,
  adapter_id: string,
  agent_kind: codex | claude | opencode | other,
  agent_session_key: string,
  workspace_path: string | null,
  pane_id: EntityId | null,
  state: starting | processing | awaiting_input | completed | failed | interrupted,
  reason: string | null,
  occurred_at: RFC3339,
  metadata: object
}
```

**约束**：安装计划必须列出将修改的路径并在应用前获得用户确认；未知 Agent 原始字段进入 `metadata`；Adapter 不支持恢复时返回 `UNSUPPORTED`，不得伪造恢复命令。

### 4.5 Prompt Queue

**方向**：UI → Prompt Workflow → Terminal Runtime
**形式**：共享状态与命令

```text
PromptItem {
  id: EntityId,
  agent_session_id: EntityId,
  content: string,
  attachments: PromptAttachment[],
  state: draft | queued | dispatching | sent | failed | cancelled,
  position: u32,
  created_at: RFC3339,
  error: AppError | null
}

PromptAttachment {
  kind: path_reference | terminal_selection | inline_text | screenshot_path,
  value: string,
  display_name: string
}
```

**约束**：每个 Agent Session 同时只能有一个 `dispatching` 条目；BELFRY 只向本地终端写入文本或路径引用，不上传附件；Agent 正在处理时默认排队，用户明确选择“立即发送”才能绕过队列。

### 4.6 配置与持久化路径

**方向**：Persistence & Config ↔ 所有模块
**形式**：文件协议 + SQLite

```text
%APPDATA%\Belfry\config.toml
%APPDATA%\Belfry\themes\*.belfrytheme
%APPDATA%\Belfry\recipes\*.belfryrecipe
%LOCALAPPDATA%\Belfry\state.db
%LOCALAPPDATA%\Belfry\sessions\
%LOCALAPPDATA%\Belfry\logs\
%LOCALAPPDATA%\Belfry\cache\
```

**约束**：配置写入使用临时文件 + 原子替换；TOML 解析失败时保留原文件并加载最后一次有效快照；SQLite schema migration 必须事务化；日志不得写入 Prompt 正文和环境变量值。

### 4.7 Control Plane 协议

**方向**：belfry CLI / hooks → Control Plane → App Core
**形式**：Windows Named Pipe 上的 UTF-8 JSON Lines

```text
pipe: \\.\pipe\belfry-{user_sid}

ControlRequest  { v: 1, id: EntityId, command: string, args: object }
ControlResponse { v: 1, id: EntityId, ok: bool, result: object | null, error: AppError | null }
```

**约束**：Named Pipe ACL 只允许当前用户 SID；每行最大 1 MiB；请求必须在 30 秒内响应或返回 `TIMEOUT`；PTY 执行类命令可返回任务 ID 并异步完成；管理员实例使用独立 pipe，禁止跨权限转交 PTY handle。

### 4.8 Resource URI 与 Recipe

**方向**：Content & Git / Navigation & Recipes ↔ Workspace / SSH
**形式**：URI 和版本化文件协议

```text
ResourceUri = file:///C:/path | ssh://profile-id/absolute/path

RecipeV1 {
  version: 1,
  name: string,
  workspace: LayoutNode,
  steps: RecipeStep[],
  replay: auto | ask_once | step_by_step | skip
}

RecipeStep = open_shell | split | run_command | launch_agent | open_resource
```

**约束**：外部 `.belfryrecipe` 默认 `step_by_step`；路径必须经过 Resource URI 解析，不允许字符串拼接 shell 命令；远程资源必须绑定已存在的 SSH Profile。

## 5. 子 feature 清单

1. **terminal-vertical-slice** — 启动 PowerShell ConPTY 并完成输入输出、缩放和退出。
   - 所属模块：Desktop Platform / Terminal Runtime
   - 依赖：无
   - 状态：planned
   - 对应 feature：未启动
2. **shell-profiles-wsl** — 检测并启动 PowerShell、CMD、WSL 和 Git Bash Profile。
   - 所属模块：Terminal Runtime
   - 依赖：terminal-vertical-slice，因为它提供可启动的 TerminalSession。
   - 状态：planned
   - 对应 feature：未启动
3. **terminal-interaction-compatibility** — 完成 ANSI、Unicode、IME、选择、剪贴板、搜索和链接交互。
   - 所属模块：Terminal Runtime
   - 依赖：terminal-vertical-slice，因为它提供终端输入输出和渲染通道。
   - 状态：planned
   - 对应 feature：未启动
4. **workspace-tabs-panes** — 实现窗口、标签、递归分屏和焦点管理。
   - 所属模块：Workspace Runtime
   - 依赖：terminal-vertical-slice，因为 Pane 需要承载可运行终端。
   - 状态：planned
   - 对应 feature：未启动
5. **settings-config-themes** — 实现 TOML 配置、设置页、字体和主题系统。
   - 所属模块：Persistence & Config / Desktop Platform
   - 依赖：terminal-vertical-slice，因为设置需要实时终端预览和应用目标。
   - 状态：planned
   - 对应 feature：未启动
6. **session-persistence-restore** — 持久化并恢复窗口、标签、Pane 和进程上下文。
   - 所属模块：Workspace Runtime / Persistence & Config
   - 依赖：workspace-tabs-panes, settings-config-themes，因为需要稳定布局结构和持久化配置。
   - 状态：planned
   - 对应 feature：未启动
7. **agent-integration-foundation** — 建立 Agent Adapter、状态协议、检测和 hooks 安装框架。
   - 所属模块：Agent Runtime
   - 依赖：workspace-tabs-panes, session-persistence-restore，因为 Agent 必须绑定 Pane 并保存会话身份。
   - 状态：planned
   - 对应 feature：未启动
8. **codex-agent-adapter** — 接入 Codex hooks、状态和恢复能力。
   - 所属模块：Agent Runtime
   - 依赖：agent-integration-foundation，因为它提供统一 Adapter 和生命周期契约。
   - 状态：planned
   - 对应 feature：未启动
9. **agent-status-notifications** — 展示 Agent 徽标、系统通知和任务栏状态。
   - 所属模块：Agent Runtime / Desktop Platform
   - 依赖：agent-integration-foundation, codex-agent-adapter，因为需要标准事件和真实 Agent 数据源。
   - 状态：planned
   - 对应 feature：未启动
10. **prompt-composer-queue** — 实现多行 Composer、附件上下文和 Prompt Queue。
    - 所属模块：Prompt Workflow
    - 依赖：workspace-tabs-panes, agent-integration-foundation，因为 Prompt 需要目标 Pane 与 Agent Session。
    - 状态：planned
    - 对应 feature：未启动
11. **agent-history-resume** — 保存 Agent 生命周期和日志并恢复可恢复会话。
    - 所属模块：Agent Runtime / Persistence & Config
    - 依赖：session-persistence-restore, agent-integration-foundation, codex-agent-adapter，因为需要持久化、恢复契约和首个真实实现。
    - 状态：planned
    - 对应 feature：未启动
12. **open-quickly-command-palette** — 搜索窗口、标签、Agent、命令和项目。
    - 所属模块：Navigation & Recipes
    - 依赖：workspace-tabs-panes, session-persistence-restore, agent-integration-foundation，因为搜索结果来自这些统一状态源。
    - 状态：planned
    - 对应 feature：未启动
13. **claude-agent-adapter** — 接入 Claude Code hooks 和恢复能力。
    - 所属模块：Agent Runtime
    - 依赖：agent-integration-foundation，因为它提供统一 Adapter 契约。
    - 状态：planned
    - 对应 feature：未启动
14. **opencode-agent-adapter** — 接入 OpenCode plugin 事件和恢复能力。
    - 所属模块：Agent Runtime
    - 依赖：agent-integration-foundation，因为它提供统一 Adapter 契约。
    - 状态：planned
    - 对应 feature：未启动
15. **ssh-remote-integration** — 支持 SSH、远程环境、terminfo、远程文件和 Git。
    - 所属模块：Terminal Runtime / Content & Git
    - 依赖：shell-profiles-wsl, terminal-interaction-compatibility, session-persistence-restore，因为远程会话依赖 Profile、终端兼容和连接恢复状态。
    - 状态：planned
    - 对应 feature：未启动
16. **file-editor-preview-panes** — 实现文件浏览、编辑以及 Markdown 等内容预览。
    - 所属模块：Content & Git / Workspace Runtime
    - 依赖：workspace-tabs-panes, settings-config-themes，因为内容 Pane 使用同一布局和编辑器设置。
    - 状态：planned
    - 对应 feature：未启动
17. **git-details-panel** — 实现状态、Diff、分支、提交和远程 Git 操作。
    - 所属模块：Content & Git
    - 依赖：ssh-remote-integration, file-editor-preview-panes，因为 Git 面板需要统一的本地/远程资源访问与内容展示。
    - 状态：planned
    - 对应 feature：未启动
18. **recipes-workspace-replay** — 保存并安全重放命令、Agent 和工作区布局。
    - 所属模块：Navigation & Recipes / Workspace Runtime
    - 依赖：workspace-tabs-panes, settings-config-themes, session-persistence-restore, agent-integration-foundation，因为 Recipe 引用布局、配置和 Agent 启动能力。
    - 状态：planned
    - 对应 feature：未启动
19. **control-cli-core** — 实现 belfry CLI 和窗口、标签、Pane 控制协议。
    - 所属模块：Control Plane
    - 依赖：workspace-tabs-panes, agent-integration-foundation，因为 CLI 控制这些领域对象并接收 Agent hook 状态。
    - 状态：planned
    - 对应 feature：未启动
20. **frecency-open-recent** — 实现目录学习、jump 和最近项目导航。
    - 所属模块：Navigation & Recipes / Control Plane
    - 依赖：session-persistence-restore, open-quickly-command-palette, control-cli-core，因为需要历史数据、搜索 UI 和 CLI 入口。
    - 状态：planned
    - 对应 feature：未启动
21. **import-export-parity** — 导入导出配置、主题、Recipe 及主流终端格式。
    - 所属模块：Persistence & Config / Navigation & Recipes
    - 依赖：settings-config-themes, recipes-workspace-replay，因为导入导出的目标 schema 必须先稳定。
    - 状态：planned
    - 对应 feature：未启动
22. **windows-integration-packaging** — 完成安装、更新、文件关联、上下文菜单、通知及 x64/ARM64 发布。
    - 所属模块：Desktop Platform / Control Plane
    - 依赖：settings-config-themes, agent-status-notifications, control-cli-core，因为安装包需要注册配置、通知和 CLI 入口。
    - 状态：planned
    - 对应 feature：未启动
23. **parity-accessibility-performance** — 完成 Mac 能力对照、无障碍、性能、稳定性和双系统验收。
    - 所属模块：跨模块
    - 依赖：除基础布局和配置外的全部用户能力，因为它是最终整合验收。
    - 状态：planned
    - 对应 feature：未启动

**最小闭环**：`terminal-vertical-slice` 完成后，可以端到端演示“打开 BELFRY → 启动 PowerShell → 输入命令 → 正确渲染 → 调整窗口 → 退出”。

## 6. 排期思路

推进顺序按风险、技术依赖和已确认的 AI 编程终端定位安排：

1. **基础闭环**：terminal-vertical-slice。
2. **终端工作台**：Shell Profile、终端交互、Workspace、设置和恢复。
3. **AI 优先体验**：Agent 基础、Codex、状态通知、Composer、历史恢复和快速导航。
4. **Agent 与开发能力扩展**：Claude、OpenCode、SSH、文件编辑和 Git。
5. **生产力与外部控制**：Recipes、CLI、Frecency 和导入导出。
6. **发布与收口**：Windows 集成、x64/ARM64、无障碍、性能和完整能力验收。

技术依赖之外的同阶段顺序可以在 roadmap update 中按产品反馈调整。第一条只覆盖 PowerShell 的最窄路径，用于尽早验证 Tauri、ConPTY、xterm.js 和流式 IPC 是否能形成稳定闭环。

## 7. 观察项

- 当前没有 requirement 文档；roadmap 已记录方向，但进入首个 feature-design 前建议用 `cs-req draft` 固化用户价值和成功标准。
- 当前 architecture 只有空骨架；未来每个 feature 验收后再把实际落地结构回写，不能提前把本 roadmap 当成现状。
- xterm.js 是首发渲染器，但 Terminal Runtime API 必须保持渲染器无关，方便未来评估原生 DirectWrite 或稳定的 libghostty。
- Windows 10 已结束常规支持；本项目将 Windows 10 22H2 作为兼容目标，需要单独维护测试环境和视觉降级基线。
- Mac 配置、主题和 `.belfryrecipe` 的文件级兼容性由 import-export-parity 验证；当前只承诺体验等价。

## 8. 变更日志

- 2026-08-09：因目标平台由“Windows”纠正为“macOS + Windows”，暂停本 roadmap；所有条目保持 planned，不启动 feature。
