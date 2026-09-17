---
sidebar_position: 20
title: Agent hosting
description: Detection, session status, and activity notifications
---

# Agent hosting

## Auto-detection

On startup, Belfry automatically detects the CLI Agents installed on your machine:

- **Codex**
- **Claude Code**
- **Pi CLI**

Detection covers the executable path and version number. **When one is unavailable, the reason is shown** — not installed, missing from PATH, or version too old.

The "About" settings page shows the **local and latest versions** of all three CLIs at once, with one-click upgrades. Version detection reverse-resolves the executable's real package name: if you installed a third-party mirror package (such as `@cometix/claude-code`) that lags behind the official one, the card will show the official version, while the upgrade action still only targets the package you actually installed — it never swaps it out from under you.

## Session status

Belfry distinguishes session status across **two combined dimensions** — this is the core of what makes it better than a plain terminal:

**Process lifecycle** (is the session alive):

- Creating
- Running
- Exited
- Errored

**Current behavior** (what is it doing right now):

- Idle
- Outputting
- Waiting for you to choose

Stack the two together, and a glance at the sidebar tells you: which sessions are running, which have stopped, and which are stuck waiting for your confirmation.

## Tab naming

Tab titles are **extracted automatically from your first sentence** — no manual naming needed. The full original text lives in the tooltip, visible on hover.

## Activity notifications

Belfry's notifications are deliberately restrained — **only two things are worth interrupting you for**:

1. The Agent finished the job
2. It's stuck on a question only you can answer

A few intentional details:

- **Completion notifications are delayed by 1500 ms.** Activity is inferred by scanning screen text, and the "outputting → idle → waiting for you" path is very common (the spinner disappears first, the permission box a beat later). Sending a "done" notification in that gap would be a pure false positive.
- **No notification while you're already watching that session** — you've already seen it.
- **Status goes in the title, identity in the body**: you decide whether to act now, then which session it is.
- Unread counts roll up into the Dock / taskbar badge and clear automatically when you return to the app.

## Task queuing

Tasks dispatched from the collaboration panel are **queued per target Agent**. Delivery is held while an Agent is busy or waiting for confirmation, and resumes in order once it's idle again. See [Session collaboration](./collab.md).
