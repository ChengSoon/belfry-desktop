---
sidebar_position: 1
title: What is Belfry
description: A cross-platform terminal workbench for hosting CLI Agents
---

# What is Belfry

Belfry is a desktop app that runs command-line Agents like [Codex](https://github.com/openai/codex), Claude Code, and Pi CLI in a single interface across macOS and Windows — and it is also a full-featured terminal in its own right.

In short: **it hosts the CLI Agents already installed on your machine, and helps you see what they're working on and what they're waiting for.**

## The problems it solves

Running CLI Agents directly in a system terminal has a few friction points:

- **Multiple sessions mean multiple terminal windows**, and switching between them gets disorienting
- **You can't tell which session has finished and which is waiting for your confirmation** without checking each window
- **No visibility into token spend** — you have to dig through logs yourself
- **Getting two Agents to cooperate** means copy-pasting between windows by hand

Belfry brings all of this into one workbench: side-by-side splits, status at a glance, notifications that only fire when they actually matter, automatic usage stats, and the ability to hand tasks directly between sessions.

## Design principles

Understanding these trade-offs will help you decide whether Belfry fits you:

- **CLI requests are sent directly by the Agent.** Provider switching modifies the CLI's own configuration file; API keys are stored locally the way the CLI stores them. Belfry's main interface stays centered on the terminal and session management — it is not a proxy layer.
- **Degrades gracefully to a plain terminal when Agents are unavailable.** Agent integration is an enhancement, not a prerequisite. A failed detection should never stop you from opening a Shell.
- **Platform differences are contained inside adapters.** Business code never writes `if (windows)`, but menus, shortcuts, and window behavior follow each platform's conventions — pixel-perfect parity is not a goal.

## Scope

Belfry is a **local terminal and CLI Agent workbench for macOS / Windows**. The following are out of scope:

- iOS / Android / Web versions
- Cloud sync, account systems, cloud-based team collaboration
- LSP or debuggers
- Silent privilege escalation

:::note A note on permissions
Belfry is a hosting layer for terminals and sessions. It is not responsible for the commands an Agent executes on your machine. The Agent's permissions are your shell's permissions: if you give it read/write access to files, the ability to run builds and install dependencies, it also has the ability to delete things it shouldn't. **Use it inside version-controlled directories**, and keep an eye on important operations.
:::

## Next steps

- [Installation](./install.md) — downloading and the first-launch trust steps
- [Quick Start](./quickstart.md) — your first session in five minutes
