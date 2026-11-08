---
name: belfry
description: "Collaborate with other real Belfry Agent sessions: list peers, coordinate in rooms, assign work through the room task board or send, and report done/fail. When the user names sessions in the sidebar (reviewer, frontend, tests), requests to delegate to those names refer to those real sessions, not newly spawned subagents. Check belfry peers first. Requires BELFRY_TAB_ID."
---

# Belfry session collaboration

Belfry is a terminal workspace where the user can see and take over each Agent session. The `belfry` command sends work to those sessions and displays its status in the collaboration panel.

Before using it, verify that this is a hosted session:

```bash
test -n "${BELFRY_TAB_ID:-}"
```

If the variable is missing, explain that Belfry collaboration is unavailable here. Do not guess an endpoint.

## Find sessions

```bash
belfry peers
```

This lists each session's sidebar name, Agent type, availability, and title. Your session is marked `*`.

Use the **sidebar name** to address a session; a title or Agent type is not an address. Titles change during conversation, and several sessions can use the same Agent. A session without a name must first be named by the user in the sidebar. Names may include Chinese characters and must not contain spaces. The CLI also accepts an exact tabId.

## Collaboration rooms

The user creates a room and adds sessions. The coordinator splits the request into tasks, assigns them by responsibility, monitors progress, and reports to the user. Members perform their assigned work. Your onboarding message identifies your role and responsibilities.

```bash
belfry rooms          # Your rooms, role, coordinator, and open work
belfry room status    # Brief, members, task board, and required replies
belfry room log       # Recent messages with short IDs; --count sets the number
```

When you belong to more than one room, add `--room <room-name>` to room commands.

### Messages

```bash
belfry room say Is the API contract ready?
belfry room say @backend Please check the timeout
belfry room say --to @all Review the updated brief
belfry room say --ask @frontend Can we integrate today?
belfry room say --reply a1b2c3d4 Yes, at four
```

Without recipients, a member's message goes to the coordinator and the coordinator's message goes to the other members. `--to` supports role names, `@all`, `@members`, `@coordinator`, and `@user`. The legacy aliases `@peers` and `@foreman` are also accepted. `--ask` keeps a reply request open; `--reply` responds to the original sender by default and resolves that reply request.

Reply to messages listed as requiring your response. Ordinary messages need no reply if you have nothing to add. Use `--to @user` for decisions or final reports; the user reads them in the app. Send at most 12 messages per minute.

### Task board

Task IDs are T1, T2, and so on. Everyone in the room shares the same board.

```bash
belfry room task add Login API --to backend --outcome "Return the session ID and expiry"
belfry room task start T1
belfry room task note T1 Integration verified
belfry room task done T1 Implemented and tested; contract is in docs/api.md
belfry room task assign T3 frontend
belfry room task reopen T1
```

Use `--after T1,T2` when creating work that depends on other tasks.

- **Coordinator:** Read the brief, divide the request into tasks, and assign them by role using the task board. Do work yourself only when it is very small or no suitable member is available. Assign the next task when members finish or have no remaining work. Report completion with `belfry room say --to @user`. Update the brief with `belfry room brief --focus <focus>` (also `--objective` and `--constraint`).
- **Member:** Work on your assigned tasks. Mark each started and then done with the artifacts and validation results. Tell the coordinator about blockers or requests for assistance; members cannot assign work to other members. Members may claim unassigned work for themselves.
- Use `belfry room task done` for room work. `belfry done` settles direct assignments created by `belfry send`.

If a room command fails, report the original error and inspect `belfry room status` before proceeding. Do not bypass the task board with `belfry send` or automatically create duplicate tasks after an uncertain response.

## Direct assignments

```bash
belfry send reviewer Review the edge cases in src/auth.ts and report actionable issues
```

Words are joined into one instruction; quoting is optional unless your shell requires it. Direct assignments are appropriate outside an existing room task workflow.

- **Accepted or queued does not mean delivered or started.** Work waits while the target is busy or awaiting approval. Only a submitted receipt confirms submission to the terminal; it does not prove that the recipient has completed the work.
- When delegating part of an incoming assignment, include `--parent <task-id>` so depth and cycle checks use the correct chain.
- The service explains rejected requests, including cross-project delegation, self-assignment, more than three hops, cycles, and unavailable targets.
- An uncertain submission requires checking the target terminal. Do not paste the task again automatically.

## Receive and settle work

```bash
belfry inbox
belfry done <task-id> Implemented and verified
belfry fail <task-id> Explain why the work cannot be completed
```

A direct assignment contains the command to run when finished:

```text
[belfry] Task 01m1bqyc from "planner"
Review the edge cases in src/auth.ts
When finished, run: belfry done 01m1bqyc
```

**`done` is the authoritative completion signal.** Activity detection only estimates whether a session is busy. Without a completion report the sender cannot know the result. If you cannot finish, report `fail` with a useful explanation.

## Wait for results

```bash
belfry send ui Implement the agreed view
belfry wait <task-id>
```

Before waiting, tell the user whose result you are waiting for. `wait` has no default time limit; use `--timeout <seconds>` when you need one. A timeout means the task is still unsettled, not that it completed. The output includes the latest status.

`wait` also returns when collaboration is stopped or the target session disappears. An abandoned task is not a successful completion. Read the returned status before continuing dependent work. You can wait only for tasks that you assigned. To wait for several already running tasks, wait for each in turn.

## Command syntax and language

```bash
belfry --help
```

Use the installed binary's help as the authority for command syntax. Errors go to stderr with a nonzero exit code and normally explain the next step. Help works outside a hosted session.

CLI language follows the app setting, then the system language. `BELFRY_LANG=en` or `BELFRY_LANG=zh-CN` overrides it for an invocation. Names, task instructions, and other user content are preserved.

## Real sessions and temporary subagents

A named Belfry session is a real, long-running workspace opened by the user, with its own history. Sending it work uses that workspace and is visible to the user. A temporary subagent is separate and is not a replacement for a named real session.

If the user has named sessions such as coordinator, frontend, and tests, instructions to delegate to those names refer to the real sessions. Run `belfry peers` to confirm. Do not spawn an agent impersonating a named session. For independent parallel work with no named session, use temporary subagents only when your current instructions permit them. Worktrees provide branch isolation and are a separate concept.

- Check peers and availability before assigning direct work.
- Never answer another terminal's permission prompt for the user.
- The user controls opening, closing, and naming sessions. You can assign work and report results.
