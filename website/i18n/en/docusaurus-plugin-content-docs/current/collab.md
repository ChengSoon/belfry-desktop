---
sidebar_position: 22
title: Session collaboration
description: Getting multiple CLI Agent sessions to work together
---

# Session collaboration

If you run several Agent sessions at once, you can let them **cooperate**: one on the frontend, one on the backend, without you relaying messages by hand.

## Stable session names

Collaboration requires being able to name your targets. Give each Agent session a **stable name** (like `frontend`, `tests`), fixed across the whole project and preserved when sessions reopen.

> Naming your sessions in the Belfry sidebar (reviewer, frontend, tests, and so on) is itself the signal that gives collaboration clear targets. **"Hand it to frontend" refers to that session.**

## The built-in belfry CLI

Collaboration happens through the built-in `belfry` command line, across sessions in the same project:

- **send** — dispatch a task to a session
- **wait** — wait for the other side to finish
- **done / fail** — report completion or failure

Tasks are **queued per target Agent**. Delivery is held while the other side is busy or waiting for confirmation, and resumes in order once it's idle — messages never get injected into a conversation already in progress.

## Approval gates

Collaboration tasks can have **approval gates**: sensitive operations need your sign-off before executing. There are also **loop and hierarchy limits** to prevent sessions endlessly delegating to each other.

## Collaboration status panel

One panel shows it all: who is waiting on whom, how many tasks are queued, and what has been delivered.

## Environment diagnostics

Collaboration depends on a runtime environment (the Belfry skill, CLI login state, collaboration channels). The settings page provides **diagnostics** for:

- Whether the Belfry skill is present and up to date
- Codex / Claude Code login and feature status
- doctor results and collaboration channel connectivity

Diagnostics can **sync the built-in skill automatically or manually**. Each client reports its status separately and **partial successes are preserved** — if Claude is fine but Codex isn't logged in, one failure doesn't bury the other.
