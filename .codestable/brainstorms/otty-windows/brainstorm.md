---
doc_type: brainstorm
slug: otty-windows
created: 2026-07-30
status: active
summary: 探索完整覆盖 Mac OTTY 能力、同时遵循 Windows 交互习惯的 AI 编程终端
tags: [windows, terminal, ai-agent, product-design, cross-platform]
---

# OTTY Windows

> 创意空间 | 2026-07-30 | 下一步：cs-roadmap

> **范围纠正（2026-08-09）**：最终目标是 macOS + Windows 跨平台桌面应用，不包含 iOS。本文保留早期 Windows 方向的讨论痕迹，当前规划由 `otty-desktop` roadmap 承接。

## 出发点

OTTY 当前只有 Mac 版本，需要从零开发 Windows 版本。目标不是做一个外观相似的终端壳，而是覆盖 Mac OTTY 的完整产品能力，并针对 Windows 的 Shell、窗口系统、快捷键、通知、权限和视觉语言提供等价体验。

本轮讨论参考了本机 OTTY Mac 1.3.1 的应用资源、CLI 能力和中文本地化配置。现有产品已经覆盖终端、多窗口与分屏、文件浏览与编辑、Git、Agent 集成、Prompt Queue、Recipe、会话恢复、快速打开、主题与 CLI 控制等能力，因此 Windows 版属于多 feature 产品，而不是单一功能移植。

## 聊过的方向

- 产品范围讨论过三种方向：Windows 原生终端 MVP、完整覆盖 Mac OTTY、AI 原生差异化终端。最终选择以完整覆盖 Mac OTTY 为产品终态，但仍通过分阶段交付控制风险。
- “完整复刻”讨论过视觉复刻、体验等价和数据完全兼容。最终选择体验等价：保留功能、工作流和配置语义，界面与操作遵循 Windows 平台习惯，不逐像素复制 macOS。
- 默认体验讨论过日常终端、AI 编程终端、项目工作台和多模式选择。最终选择 AI 编程终端，Agent 会话状态、恢复、通知和 Prompt 调度成为一级能力；终端画布仍是核心，不退化为封闭聊天界面。
- Agent 接入讨论过托管现有 CLI Agent、内置模型客户端和混合模式。最终选择托管 Codex、Claude Code、OpenCode 等现有 CLI Agent，通过 hooks 或插件感知生命周期，不直接调用模型 API，也不管理模型密钥。
- 系统范围讨论过 Windows 11 only、Windows 10/11 双平台和 Windows 11 首发。最终选择同时支持 Windows 10 与 Windows 11，功能和布局一致，视觉效果按系统能力降级。

## 当前倾向

产品定位倾向于：**一个能理解、管理并恢复多个 AI 编程 Agent 会话的 Windows 原生终端工作台。**

主要界面以 Agent Terminal Workspace 为核心：左侧显示按项目和状态组织的 Agent 会话，中间是可标签化和分屏的终端/编辑器画布，底部按需展开 Prompt Composer 与 Prompt Queue，右侧按需显示信息、大纲、Git 和文件详情。Command Palette 与 Open Quickly 使用覆盖层完成跨窗口、标签、目录、SSH、Recipe 和 Agent 会话导航。

产品能力初步分为：

1. Terminal Core：ConPTY、PowerShell、CMD、WSL、Git Bash、SSH、ANSI、Unicode、字体与滚动历史。
2. Workspace：窗口、标签、分屏、Pane 管理、标签分组、状态徽标和会话恢复。
3. Content Panes：终端、文件浏览、文件编辑、Markdown/HTML/SVG/JSONL 预览。
4. Navigation：Command Palette、Open Quickly、最近项目、目录跳转和全局搜索。
5. Developer Tools：Git、Diff、分支操作、文件大纲和外部工具联动。
6. Agent Integration：hooks/插件安装、生命周期状态、通知、历史和会话恢复。
7. Prompt Workflow：Composer、Prompt Queue、终端选区与文件上下文插入。
8. Recipes：保存并重放命令、项目上下文与工作区布局。
9. Settings and CLI：图形设置、配置文件、快捷键、主题和运行时控制 CLI。

## 已敲定的点

- 已确认：完整覆盖 Mac OTTY 是产品终态，实际实现需要拆成多个可验收 feature。
- 已确认：追求 Windows 平台上的体验等价，不追求 macOS 视觉和交互的逐像素复刻。
- 已确认：AI 编程终端是默认体验；Agent 状态是一级信息，终端始终是主要工作区域。
- 已确认：只托管现有 CLI Agent；OTTY 不内置模型推理客户端，不保存或代理模型 API Key。
- 已确认：同时支持 Windows 10 和 Windows 11。
- 已确认：Windows 11 可使用 Mica/Acrylic 和现代窗口效果；Windows 10 使用不透明背景、标准阴影和兼容标题栏降级，核心布局与功能不降级。
- 已确认：macOS 专属概念采用平台等价替换，例如 Finder 对应 File Explorer、Dock 对应 Taskbar、Cmd/Option 对应 Windows 快捷键语义，而不是机械键位映射。
- 倾向：Agent 处理、等待输入、完成、失败和中断使用稳定、可扫描的状态体系，并映射到标签徽标、系统通知和任务栏状态。
- 倾向：Agent 集成不可用时自动退化为普通终端，不能阻塞 Terminal Core。

## 遗留问题 & 下一步

- 需要在 roadmap 中确定跨 Windows 10/11 的 UI 技术栈、终端渲染栈和最低系统版本，并验证 ConPTY、DirectWrite/Direct3D、WSL 与 SSH 的边界。
- 需要明确 Mac OTTY 配置、主题和 `.ottyrecipe` 与 Windows 版的数据兼容等级；当前只确认体验等价，尚未承诺文件级完全兼容。
- 需要为 Codex、Claude Code、OpenCode 等逐一验证 Windows hooks/插件机制、状态协议和恢复命令，避免把不同 Agent 强行抽象成不真实的统一接口。
- 需要定义会话恢复的安全边界，尤其是自动重跑命令、管理员终端、远程 SSH 和等待确认状态。
- 需要确定 Git 和编辑器能力是完整内建，还是在第一阶段以详情面板和外部应用联动为主。
- 需要设计 Windows 10 的视觉降级验收标准，保证降级后仍是完整产品体验，而不是被视为次等版本。
- 下一步使用 `cs-roadmap` 拆分模块依赖、接口契约、最小闭环和分阶段交付顺序。
