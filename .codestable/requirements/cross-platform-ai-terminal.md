---
doc_type: requirement
slug: cross-platform-ai-terminal
pitch: 在 Mac 和 Windows 上，用一致的方式运行终端并管理 AI 编程会话
status: draft
last_reviewed: 2026-08-09
implemented_by: []
tags: [terminal, ai-agent, macos, windows, cross-platform]
---

# 跨平台 AI 编程终端

## 用户故事

- 作为需要在 Mac 和 Windows 之间切换的开发者，我希望两端拥有一致的工作区、配置和操作习惯，而不是每换一台电脑就重新适应终端。
- 作为同时运行多个 Codex、Claude Code 或 OpenCode 会话的开发者，我希望一眼看出哪个任务正在处理、等待输入、已经完成或执行失败，而不是逐个标签检查。
- 作为经常切换项目的开发者，我希望重新打开 BELFRY 后继续之前的标签、分屏、目录和可恢复 Agent 会话，而不是重新搭建工作现场。
- 作为熟悉各自操作系统的用户，我希望 BELFRY 在能力一致的同时遵循 Mac 和 Windows 的菜单、快捷键、窗口与通知习惯，而不是让其中一个平台使用生硬的移植界面。

## 为什么需要

普通终端只负责显示命令输出。使用 AI 编程工具后，一个人经常同时维护多个耗时会话，还要记住它们属于哪个项目、是否等待输入、完成后应该回到哪里。切换操作系统时，Shell、快捷键和系统交互的差异又会打断已经形成的工作习惯。

## 怎么解决

BELFRY 在 Mac 和 Windows 上提供同一种终端工作区，让用户从一个地方运行本地 Shell 和已有的 CLI Agent，查看任务状态、组织标签与分屏、排队发送 Prompt，并在应用重启后恢复工作现场。两个平台共享核心工作流，同时保留符合各自系统习惯的操作方式。

## 边界

- 只面向 macOS 和 Windows 桌面端，不覆盖 iOS、Android、Web 或浏览器远程版。
- BELFRY 托管用户已经安装的 CLI Agent，不内置模型服务，也不保存模型 API Key。
- 两个平台追求能力和工作流一致，不要求界面逐像素相同。
- 不提供云同步、账号体系、团队协作、插件市场、语言服务器或调试器。
- 需要提权的命令、来源不明的 Recipe 和不可确认的 Agent 恢复不会被自动执行。
- 某个平台不具备对应系统能力时，应清楚说明限制，而不是模拟一个不可靠的替代行为。
