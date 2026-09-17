---
sidebar_position: 3
title: Quick Start
description: Your first Belfry session in five minutes
---

# Quick Start

Belfry does not bundle Agents — it hosts the ones already installed on your machine. So first make sure at least one of them works:

```bash
codex --version
claude --version
```

As long as you get a version number, you're set. Having neither is fine too — Shell sessions don't depend on any Agent.

## Four steps to get going

### 1. Open a project

Launch Belfry and click the **project selector** at the top to pick a local directory. This directory becomes your project, and sessions live under it.

### 2. Start a session

Pick a session type from the **new session menu** in the sidebar: Shell, SSH, Codex, or Claude.

:::info Undetected Agents appear grayed out
Agents that couldn't be detected show up grayed out in the menu — hover to see why (not installed, not on PATH, version too old, etc.).
:::

### 3. Talk to it

Once the session opens, just start typing. **The tab title is extracted from your first sentence**, with the full original text available in the tooltip on hover.

### 4. Check your token spend

Press `⌘U` (`Ctrl+Shift+U` on Windows) to open the usage panel and see which model and which project your tokens went to. See [Usage stats](./usage.md).

## Multiple sessions in one project

You can run several sessions side by side under one project — drag the tabs to split the view. A common setup: one Codex writing code, one Shell watching logs, or two Agents dividing work — see [Session collaboration](./collab.md).

## Using it as just a terminal

If neither Agent is detected, that's fine. Shell sessions don't depend on them, and Belfry works as a regular terminal: PowerShell, bash, zsh, and fish are all supported, `⌘F` searches terminal content, and SSH sessions connect through the system OpenSSH.

## Next steps

- [Workspace](./workspace.md) — how projects, sessions, and splits are organized
- [Agent hosting](./agent.md) — how to read session status
- [Keyboard shortcuts](./shortcuts.md) — the full shortcut reference
