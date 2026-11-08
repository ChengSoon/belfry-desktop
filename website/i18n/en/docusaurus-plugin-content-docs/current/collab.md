---
sidebar_position: 22
title: Session collaboration
description: Delegating work, room task boards, pending replies, and delivery receipts
---

# Session collaboration

If you run several Agent sessions at once, you can let them cooperate: one on the frontend, one on the backend, without relaying messages by hand. Use session collaboration for a simple delegation, or create a room for an ongoing requirement with a coordinator, members, and a shared task board.

:::note Version availability
Rooms and shared task boards were introduced in v0.23. Persistence, delivery stages, the pending-reply inbox, and history browsing marked below as “Next version (Unreleased)” belong to an update that has not been released yet.
:::

## Stable session names

Give each Agent session a **stable name** (such as `frontend` or `tests`), unique within the project and preserved when sessions reopen. Ordinary delegation uses the sidebar session name; room messages use the recipient's role name in that room. You choose these names, and changing the interface language does not change them.

> Naming sessions in the Belfry sidebar (reviewer, frontend, tests, and so on) gives collaboration clear targets. “Hand it to frontend” refers to that session.

## The built-in belfry CLI

Run these commands in an Agent terminal managed by Belfry. First, list available sessions and joined rooms, and check the command help:

```sh
belfry peers
belfry rooms
belfry --help
```

Replace the example session names, roles, task IDs, and message IDs with real values. If you belong to multiple rooms, append `--room "Room name"` to each `belfry room ...` command to select one explicitly.

### Delegating between sessions

The sender uses `send`, then uses the returned task ID to check or wait for the result:

```sh
belfry send tests "Run the login regression tests and report any failures"
belfry wait <task-id> --timeout 60
```

The recipient checks `inbox` and chooses either `done` or `fail` when reporting the result:

```sh
belfry inbox
belfry done <task-id> "Login tests passed; verification is recorded in the project docs"
belfry fail <task-id> "The test environment could not start; the error and reproduction steps are recorded"
```

Without `--timeout`, `wait` continues waiting. A timeout ends only that wait; it does not cancel the recipient's task or mean the task is complete. The `<task-id>` here comes from `send` and is separate from room task numbers such as `T1`.

When delegating part of a task assigned to you, add `--parent <task-id>` to `send` so Belfry can track the relationship and enforce hierarchy limits.

Tasks are queued per target Agent. Delivery pauses while the recipient is busy or waiting for confirmation, then proceeds in order when it is idle. See “Delivery stages” below for the distinction between queuing and submission.

## Rooms and the shared task board

Create a room from “Collaboration rooms” in the sidebar, choose a coordinator and members for the requirement, and fill in its objective, current focus, and constraints. The coordinator breaks down the work, assigns tasks, and follows progress. Members work on their assignments and report results or blockers to the coordinator.

Inside the room, you can view the conversation, task board, collaboration flow, and member terminals. From a terminal, use:

```sh
belfry room status
belfry room log --count 20
belfry room brief
```

The board uses room-local numbers such as `T1` and `T2`, tracks tasks as not started, in progress, completed, or archived, and supports dependencies. The coordinator can update the brief and assign work, for example:

```sh
belfry room brief --objective "Complete login" --focus "Agree on the API first" --constraint "Keep existing login methods"
belfry room task add "Implement the login API" --to backend --outcome "API regressions pass and usage is documented"
belfry room task add "Connect the login UI" --to frontend --after T1 --outcome "Login and error messages work"
```

The last command assumes that the API task was assigned `T1`; use the ID actually returned. Members update their assignment as work progresses:

```sh
belfry room task start T1
belfry room task note T1 "The API is implemented; regression tests are running"
belfry room task done T1 "Tests passed and API usage is documented"
```

When blocked, record the reason with `belfry room task note` and tell the coordinator what help you need. The coordinator can also use `belfry room task assign T1 role` to change the owner, `belfry room task reopen T1` to reopen the task, or `belfry room task archive T1` to archive it. Archiving affects the task board only; it does not archive or delete room history.

Complete room assignments with `belfry room task done T1`. Ordinary delegated tasks use `belfry done`, `belfry fail`, and `belfry wait` with their own task IDs.

### Sending messages and pausing a room

```sh
belfry room say "The API is ready; usage is in the project docs"
belfry room say "Please confirm the login API parameters" --to backend --ask
```

With no recipient specified, a member's message goes to the coordinator, and the coordinator's message goes to everyone. Select a recipient with `--to role` or an `@role` mention in the text. The `--to` option also accepts `@全体` (all), `@成员` (members), `@统筹` (coordinator), and `@用户` (user). The next version (Unreleased) adds the English aliases `@all`, `@members`, `@coordinator`, and `@user`.

Pausing a room keeps recording messages but stops delivery to member terminals and pauses idle reminders. Work already running continues.

## Pending replies and replying by ID

Adding `--ask` to a message keeps a pending reply open for its recipients. Reply using that message's ID:

```sh
belfry room say "The parameters are confirmed; integration can begin" --reply <message-id>
```

The `<message-id>` is the identifier shown on the message, separate from a task board number. A reply with `--reply` clears the corresponding recipient's pending item; if there are multiple recipients, each replies separately. Members can use `belfry room status` to check which replies they owe. Completing a task does not answer every pending message.

**Next version (Unreleased):** the room's pending-reply and reply-by-ID control lets you open the original message, quote it, and reply. Enter a full message ID or an unambiguous short ID; use the full ID when a short one is ambiguous. Early pending replies remain available after they leave the latest 1,000-message window, including after an application restart.

## Delivery stages (Next version / Unreleased)

The collaboration panel separates delivery stages from work results and shows the reason for a stalled delivery. Room conversations also show whether a message to each member is queued or its submission is uncertain.

| Stage | Meaning |
| --- | --- |
| Accepted | The task is saved but has not entered the target terminal's queue. |
| Queued | The queue owns the task and is waiting for the target session to be ready. |
| Submitting | Submission has begun and is awaiting a terminal receipt. |
| Submitted to terminal | The terminal confirmed submission; the Agent still needs to report its result. |
| Submission uncertain | The instruction may already have been written to the terminal. Check manually; it will not be pasted again automatically. |
| Delivery cancelled | This delivery was abandoned. If submission was uncertain, the instruction may already have been written. |

A successful `send` means the task was accepted. Queuing is not submission, and “Submitted to terminal” does not mean the Agent has started or completed the work. Ordinary tasks report results through `done` / `fail`; room tasks complete their board entry through `room task done`.

### Resolving uncertain delivery

When an ordinary collaboration task shows “Submission uncertain”:

1. Select “Check target terminal” and inspect whether this instruction appears there. If the target session is unavailable, restore it before checking.
2. If you confirm that the instruction was submitted, choose “Confirm submitted.” The Agent still needs to complete the work and report its result.
3. If you decide against further delivery, select “Abandon this task” and confirm. Abandonment does not retract an instruction already written or stop work already running.

If the task changes while you are checking, the panel refreshes. Review the latest state before deciding again. For an uncertain room message, also check the member's terminal before deciding how to proceed.

## Restarts, history, and capacity (Next version / Unreleased)

Tasks and pending deliveries are saved locally, so task IDs remain available after restart. Pending deliveries continue to follow approval and queue rules, submitted tasks are not automatically redelivered, and interrupted submissions with no confirmed result remain uncertain until checked.

The main room timeline keeps the latest 1,000 messages. Use “Load earlier history” at the top to browse older records page by page. The pending-reply inbox retains older unfinished items independently, so you can reply without first finding their history page. New messages arriving during pagination preserve your reading position, and unknown or unreadable records show a readable fallback.

Room information shows the history size. **Original history is retained until the room is deleted. Back up the application data directory first if you need to keep it long term.** There is currently no “archive old history” operation. Manually deleting ledger files damages room data and cannot substitute for archiving.

The first upgrade from an older format migrates history. Later launches restore current state and unfinished items from a snapshot, without reading every historical record.

## Approval gates and the collaboration panel

Collaboration tasks can have approval gates: actions requiring your confirmation wait for your sign-off. Loop and hierarchy limits prevent sessions from endlessly delegating to each other. The collaboration panel shows who is waiting on whom, tasks awaiting approval, delivery stages, and the completion or failure results reported by Agents.

## Environment diagnostics

Collaboration depends on the Belfry skill, CLI login state, and collaboration channels. The settings page provides diagnostics for:

- Whether the Belfry skill is present and up to date
- Each CLI's login, Provider, and feature status
- doctor results and collaboration channel connectivity

Diagnostics can sync the built-in skill automatically or manually. Codex, Claude Code, Pi, Antigravity CLI, OpenCode, and Kimi Code report separately, preserving partial successes. For example, if Claude is working but Codex is not logged in, Claude's results remain available.
