---
sidebar_position: 23
title: A2A connections
description: Local and external Agent collaboration, explicit reports, rooms and project connections
---

# A2A connections

:::note New capability
This page covers the external client, local Gateway and collaboration tools provided from 1.0.10. The native, embedded MCP and HTTP paths are connected; adapter and validation boundaries are described below.
:::

A2A lets Agents in your project exchange tasks, progress and results with local and external Agents through the same standard protocol. The first client supports **A2A 1.0 JSON-RPC / HTTP polling** with anonymous, static Bearer or Header API-key authentication.

## Install and upgrade

The A2A backend runs in the 1.0.10 desktop host. Reopen existing CLI sessions to receive the new tools; 1.0.9 and earlier do not include these capabilities.

To run from source, prepare the development environment described in the repository README, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm desktop:dev
```

You can also build with `pnpm desktop:build` and launch the new native application.

## Local Agent collaboration

Open and name Codex PTY or Claude PTY sessions in the same project. When a CLI reads the new MCP tool directory and the host verifies its running instance, it appears automatically on the left side of the project A2A link field; external connections appear on the right. Local connections need no address or credentials from you. Sessions that are not ready or have no automatic adapter display their reason.

Tell your current Agent:

> Give this review to the “Reviewer” session in this project. Tell me if it needs input, and show the result after it explicitly reports completion.

The sender discovers a `local:` connection and uses the same client tools below to send, query and follow up through real loopback HTTP. The recipient reads the full assignment and its own report handle through `A2ALocalTasks` / `A2ALocalTask`, then explicitly reports working, inputRequired, completed or failed with `A2AReportTask`. An idle terminal does not complete a task.

| Local tool | Purpose |
| --- | --- |
| `A2ALocalAgents` | Discover other ready local Agents |
| `A2ALocalTasks` / `A2ALocalTask` | Read your valid assignments, full instructions, report handles and generations; lists omit history and return `truncated`/`omitted` when over budget |
| `A2AReportTask` | Explicitly report progress, input requests, completion or failure with text results/artifacts |
| `A2AInbox` | Read messages and pending questions with pagination; lists truncate very large text and mark `textTruncated`, use `messageId` for the full message |
| `A2ARooms` / `A2ARoomContext` | Read joined rooms, roles, briefs and task boards |
| `A2ARoomSay` | Send messages, ask or answer specified questions under existing role rules |
| `A2ARoomBrief` | Coordinator updates objectives, focus and constraints; omitted fields remain, empty values clear |
| `A2ARoomTask` | Plan, assign, reopen or archive tasks; non-add operations include current expectedGeneration |

Assignments between members of a common room enter its authoritative task board. Specify the room if the Agents share several. When the sender lacks permission to assign that member (for example, two ordinary members), a plain send falls back to a direct task instead of failing because the room is shared; use `A2ARoomTask` to work on the room board explicitly. Existing permissions, task generations and persisted data remain. Answering a question does not complete a task. Task cards and corresponding inbox entries separately show explicit protocol state, questions and text artifact previews. Truncated previews are marked; read the original result or use Agent task/inbox tools for complete text.

Local protocol handles live in host memory and expire when the application restarts. The latest protocol state and text artifact previews are persisted in the app data directory and remain visible after a restart. Business tasks, room boards and inboxes remain. Recipients can read the task again and continue reporting; senders should confirm the result from the project task board or room rather than reusing an old handle.

Daily collaboration no longer requires the Belfry collaboration Skill or CLI. Bundled Chinese/English Skills and their install button are removed. Migration deletes only unchanged copies with known hashes, preserving edited copies, symbolic links and other Skills. The old CLI remains available for manual use.

The first automatic adapters cover MCP-injected Codex PTY / Claude PTY. The isolated `BELFRY_CODEX_NATIVE=1` path and other CLIs have no verified automatic adapter. The Gateway stays on loopback, with instance credentials protecting Cards and RPC. It does not expose local sessions to other machines. Queued direct tasks can be withdrawn before submission. Submitted, uncertain or running tasks may reject cancellation; room tasks have no protocol cancellation in this release.

## Configure an external connection

1. Open the target project, choose **A2A** in the project toolbar, then select **Add connection**.
2. Enter a name and the full Agent Card URL, such as `https://agent.example.com/.well-known/agent-card.json`.
3. Choose the service's authentication type and enter its credential. Header API-keys also need a Header name.
4. Check the connection to inspect its name, version, skills and compatible interface. The first JSONRPC / 1.0 interface is selected by default. Choosing an interface on a different origin or with a different tenant re-checks automatically; after entering an interface URL manually, check again.
5. Save, then ask your current Agent to discover the connection and send the specified task text.

Connections belong to the current project. The host stores credentials securely. Editing supports keep, replace or clear; the original value is never returned. Changing the authentication type, Header or target origin requires a new credential. Editing or deleting invalidates local task handles; tasks already accepted remotely need a separate cancellation request.

HTTPS URLs cannot contain user information or fragments. Local loopback services may use HTTP. Card and RPC endpoints requiring different credentials on different origins are outside the first client release.

## Agent tools

Compatible CLIs receive five shared client tools through the Belfry MCP bridge for local and external connections. No A2A plugin is required:

| Tool | Purpose |
| --- | --- |
| `A2AConnections` | Discover project connection IDs and public authentication status |
| `A2AAgentCard` | Read a configured Agent's Card and skills |
| `A2ASendMessage` | Send text, optionally following up with the original taskHandle |
| `A2AGetTask` | Read state, history and artifacts using the host-issued handle |
| `A2ACancelTask` | Attempt remote cancellation and preserve explicit rejection errors |

For example, tell your Agent:

> Discover A2A connections for this project, read the “External review” Agent Card and send the following task text. Poll with a delay while it is working. Show text artifacts when it finishes, and tell me if it needs input.

An immediate Message is not converted to a Task. Only `terminal=true` means a Task has completed, failed, been cancelled or been rejected. Handles live in host memory for 24 hours; a terminal task can still be read, but its handle cannot be reused for a follow-up — send a new message instead. Do not automatically resend the initial message after a timeout: the remote Agent may have accepted it. Stopping a local request and remote CancelTask are different operations.

## Try a local service

Start the deterministic service from the source repository root:

```sh
node scripts/plugin-tests/fixtures/a2a-server.mjs --port 17777
```

Use `http://127.0.0.1:17777/.well-known/agent-card.json` as the Card URL. Select anonymous authentication, check and save. Send `instant: hello` for an immediate message. Send an ordinary task and query it twice to receive a text artifact. Use `needs-input: test` for follow-up input or `uncancelable: test` for a cancellation rejection.

The fixture listens only on loopback, reads no project files and calls no external service. Add `--auth bearer` or `--auth apiKey` to test static authentication. The public test credential is `fixture-key`; the API-key Header is `X-API-Key`.

## Compatibility

Services need compatible A2A 1.0 Cards and requests. Older 0.3 examples are not guaranteed to work. The wire header is `A2A-Version: 1.0`; software release v1.0.1 is a patch version. The first client has no SSE, push, OAuth or Card signature verification.

Your CLI must actually discover these tools. Node, native HTTP and browser fixtures provide separate evidence for arguments, lifecycle and UI. Fixture acceptance does not establish real model tool selection or compatibility with arbitrary remote services.

Official sources: [A2A v1.0.1 Proto](https://github.com/a2aproject/A2A/blob/v1.0.1/specification/a2a.proto) · [Specification](https://a2a-protocol.org/latest/specification/).
