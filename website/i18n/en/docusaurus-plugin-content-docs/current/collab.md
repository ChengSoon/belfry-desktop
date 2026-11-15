---
sidebar_position: 22
title: Session collaboration
description: A2A delegation, room task boards, pending replies, and delivery receipts
---

# Session collaboration

Agents in one project can divide frontend and backend work and exchange tasks, follow-up input and results through A2A. For an ongoing requirement, create a room with a coordinator, members and a shared task board.

:::note Version availability
This page covers the connected A2A client, local gateway, explicit reporting and Skill migration in the source tree. These changes have not been released separately. Automatic local adapters cover MCP-injected Codex PTY / Claude PTY; autonomous model execution and real remote services remain untested. Build and launch the updated desktop host, then reopen Agent sessions to receive the new tools. The older 1.0.9 binary does not contain these changes. See [A2A connections](./a2a.md) for startup, external service configuration and validation boundaries.
:::

## Stable session names

Give each Agent a **stable name**, such as `frontend` or `tests`. Names are unique within a project and preserved when sessions reopen. Ordinary delegation uses sidebar session names; room messages use role names. Changing the interface language preserves these user-defined names.

After naming sessions `reviewer`, `frontend` and `tests`, telling an Agent to “hand it to frontend” selects that session.

## Delegate through A2A

Running local Agents with working collaboration adapters appear automatically in the current project's connections. Configure compatible external Cards and static authentication in **Project toolbar → A2A → External connections**. Ordinary CLIs need actual adapters; use the availability shown by discovery.

For example, tell the current Agent:

> List local Agents and configured external Agents available to this project and explain their capabilities. Give “run the login regression and report any failures” to tests. Poll with a delay and show the result when it finishes.

The Sender sends the specified text and uses a host-issued handle to query, follow up or request cancellation. The Recipient reads the complete task and required context through tools and explicitly reports working, input required, completed or failed, including a text result. Task prompts supply the report handle, generation and reporting tool. Daily collaboration requires no Belfry collaboration Skill or separate collaboration CLI.

“Submitted to terminal” confirms delivery. Completion requires the Recipient's explicit report; an idle terminal does not prove completion. Follow-up input continues the original task. A timeout ends only the current wait.

Tasks queue per recipient and wait while it is busy, awaiting confirmation or unavailable. Do not automatically resend an initial task after a query timeout: the service may have accepted it.

## Rooms and the shared task board

Create a room from “Collaboration rooms” in the sidebar, select a coordinator and members, and enter the objective, focus and constraints. The coordinator assigns and follows the work. Members handle their assignments and report results or requests for help.

Authorized context tools provide the room brief, members, task board, pending replies and messages. Room tasks retain business IDs such as `T1` and `T2`, statuses for planned, active, done and archived, and task dependencies.

For example, tell the coordinator:

> Read this room's objective and member responsibilities. Create “Implement the login API” for backend, with acceptance requiring passing regressions and documented usage. Then create “Connect the login UI” for frontend, dependent on the API task.

Members read their assignments and explicitly report progress and results. Record blockers and message the coordinator when assistance is needed. The coordinator can reassign, reopen or archive tasks within the existing role rules. Archiving affects the board and retains room history.

Room task IDs, Sender query handles and Recipient report handles serve different purposes. Agents use the issued handle and current generation; another session, older instance or older task generation cannot report on its behalf.

### Messages and pause

For example:

> Ask backend to confirm the login API parameters, require a reply and retain the message ID.

A member's message defaults to the coordinator; the coordinator defaults to everyone. Named roles and recipient groups follow the existing room permissions. Message tools can include topics, questions and answer IDs.

Pausing a room keeps recording messages while stopping terminal delivery and idle reminders. Work already running continues.

## Pending replies and complete messages

Messages requiring a reply keep pending items open. Recipients read the original and reply with its message ID and applicable question IDs. Answering questions and completing tasks remain separate operations.

The room's pending-reply control can open, quote and reply to originals by full or unambiguous short IDs. Early pending replies remain available after leaving the latest 1,000-message window, including after restart.

Long terminal prompts reference a full message. Agents use the message-reading tool to obtain the complete text before acting.

## Delivery stages

The collaboration panel shows delivery stages and explicit work reports. Room conversations show delivery to each member.

| Stage | Meaning |
| --- | --- |
| Accepted | Saved, before entering the terminal queue |
| Queued | Waiting for the target session to receive it |
| Submitting | Waiting for a terminal receipt |
| Submitted to terminal | Terminal submission confirmed; waiting for explicit progress or results |
| Submission uncertain | The instruction may be written; check it manually before any further delivery |
| Delivery cancelled | This delivery was abandoned; an uncertain instruction may still be written |

For uncertain delivery, select “Check target terminal” first. If the instruction is present, choose “Confirm submitted”; the Agent still needs to report its result. “Abandon this task” does not retract written instructions or stop work already running.

Stopping an HTTP request, withdrawing a queued delivery and cancelling a remote task are separate operations. A running task that cannot be safely stopped returns an explicit cancellation rejection.

## Restarts and history

Room, business task and delivery records are stored locally. Submitted tasks are not automatically redelivered; uncertain submissions wait for review. A2A handles belong to the current project, connection and Agent instance. Reopened instances rediscover connections and read authorized context.

The room timeline keeps the latest 1,000 messages. “Load earlier history” browses older originals; pending replies retain older unfinished items independently. Incoming messages preserve the current reading position.

Room information shows history size. Original history remains until the room is deleted; back up the application data directory when long-term retention is needed. There is no old-history archive operation, and manually deleting ledgers damages room data.

Deleting a room also closes and deletes every current member's Agent session, including the coordinator. These sessions stay out of the ordinary session list and do not return after a refresh or restart. Sessions already removed from the room are preserved.

## Environment diagnostics and Skill migration

Collaboration environment diagnostics check CLIs, login or Provider state and delivery channels. Local A2A discovery shows which running sessions have working adapters. Starting a CLI and receiving A2A tasks are verified separately.

The updated host stops installing the Belfry collaboration Skill and removes old copies that exactly match the bundled Chinese or English version. User-modified copies are preserved and reported. General Skills and Skills provided by other plugins remain available.

See [A2A connections](./a2a.md) for tools, compatibility and the local trial.
