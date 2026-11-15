import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { host, temporary, waitFor } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";
import { A2A_LOCAL_TOOLS } from "../../src-tauri/src/plugins/node/mcp-a2a-local-tools.mjs";

// These tests exercise the real Node MCP transport with synthetic native callbacks.
// Native Gateway/TaskBoard/HTTP acceptance is covered separately by T11/T13.
const names = A2A_LOCAL_TOOLS.map(tool => tool.name);
const ok = value => ({ ok: true, value });
const fail = (code, message, details = null) => ({ ok: false, error: { code, message, details, retryable: false, params: {} } });
const call = (session, name, args = {}, id) => mcpRequest(session, { ...(id === undefined ? {} : { id }), method: "tools/call", params: { name, arguments: args } });
const result = reply => reply.data.result;
const ready = ok({ ready: true, adapter: "mcp-pty", protocolVersion: "1.0" });
const connection = root => ({ id: "local:recipient-instance", name: "Reviewer", rootPath: root, cardUrl: "http://127.0.0.1/private/card", interfaceUrl: "http://127.0.0.1/private/rpc", revision: "private-instance",
  auth: { kind: "bearer", headerName: null, hasCredential: true, credential: "synthetic-gateway-secret" },
  local: { tabId: "recipient-tab", agent: "claude", ready: true, ticket: "private-ticket" } });
const initial = () => ({ reportHandle: "recipient-report", generation: 3,
  taskRef: { kind: "direct_task", roomId: null, id: "business-task", generation: 3 },
  task: { id: "protocol-task", contextId: "protocol-context", status: { state: "TASK_STATE_SUBMITTED" }, history: [] },
  instruction: "A complete assignment with a final marker: read-through-to-the-end", source: { kind: "direct", taskId: "business-task" } });
const senderReply = entry => ({ kind: "task", connectionId: "local:recipient-instance", taskHandle: "sender-query", task: structuredClone(entry.task), terminal: ["TASK_STATE_COMPLETED", "TASK_STATE_FAILED", "TASK_STATE_CANCELED", "TASK_STATE_REJECTED"].includes(entry.task.status.state) });

test("real MCP directory performs a private readiness handshake and discovers local connections without secrets or owner IDs", async t => {
  const root = await realpath(await temporary(t)), calls = [];
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    if (request.api === "a2a.localReady") return request.context.sessionId === "ready-ticket" ? ready : ok({ ready: false, protocolVersion: "1.0", reason: "adapterUnsupported" });
    if (request.api === "a2a.localAgents") return ok({ agents: [connection(root)], unsupported: [{ tabId: "pi-tab", name: "Pi", agent: "pi", reason: "adapterUnsupported", rootPath: "/private/project", ticket: "private-ticket" }] });
    if (request.api === "a2a.connections") return ok([connection(root)]);
    return fail("A2A_API_UNSUPPORTED", "Unsupported synthetic operation");
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "ready-ticket", agentKind: "codex", agentSession: { agent: "codex", id: "native-history" } });
  const directory = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
  assert.deepEqual(directory.filter(tool => names.includes(tool.name)).map(tool => tool.name), names);
  assert.equal(directory.some(tool => /localReady/i.test(tool.name)), false);
  for (const tool of directory.filter(tool => names.includes(tool.name))) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual({ api: calls[0].api, args: calls[0].args, context: calls[0].context }, { api: "a2a.localReady", args: [{}], context: { workspace: await realpath(root), sessionId: "ready-ticket" } });
  const agents = result(await call(session, "A2ALocalAgents")).structuredContent;
  assert.deepEqual(agents, { agents: [{ id: "local:recipient-instance", name: "Reviewer", auth: { kind: "bearer", headerName: null, hasCredential: true }, local: { agent: "claude", ready: true } }],
    unsupported: [{ name: "Pi", agent: "pi", reason: "adapterUnsupported" }] });
  assert.doesNotMatch(JSON.stringify(agents), /synthetic-gateway-secret|private-ticket|private\/project|native-history|recipient-tab/);
  assert.deepEqual(result(await call(session, "A2AConnections")).structuredContent.connections, agents.agents);
  const unsupported = await runtime.call("session.open", { workspace: root, sessionId: "unsupported-ticket", agentKind: "pi" });
  const other = (await mcpRequest(unsupported, { method: "tools/list" })).data.result.tools;
  assert.equal(other.some(tool => names.includes(tool.name)), false);
  assert.ok(other.some(tool => tool.name === "A2ASendMessage"));
  assert.equal(result(await call(session, "A2ALocalReady")).isError, true);
});

test("readiness failures preserve the ordinary MCP directory and reject false protocol readiness", async t => {
  const root = await realpath(await temporary(t));
  const runtime = await host(t, root, { platform: request => request.context.sessionId === "wrong-version"
    ? ok({ ready: true, protocolVersion: "0.3" }) : fail("A2A_AGENT_SESSION_INVALID", "Synthetic readiness failure") });
  for (const sessionId of ["failed-readiness", "wrong-version"]) {
    const session = await runtime.call("session.open", { workspace: root, sessionId });
    const directory = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
    assert.equal(directory.some(tool => names.includes(tool.name)), false);
    assert.ok(directory.some(tool => tool.name === "PluginTools"));
    assert.ok(directory.some(tool => tool.name === "A2AConnections"));
  }
});

test("cached A2A calls register a new authenticated attachment before acting, while unsupported adapters cannot act", async t => {
  const root = await realpath(await temporary(t)), calls = [], registered = new Set();
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    const owner = request.context.sessionId;
    assert.equal(request.context.workspace, root);
    if (request.api === "a2a.localReady") {
      if (owner === "unsupported-ticket") return ok({ ready: false, protocolVersion: "1.0", reason: "adapterUnsupported" });
      registered.add(owner); return ready;
    }
    assert.ok(registered.has(owner), "business operations require a new native readiness check");
    assert.equal(request.api, "a2a.localRoom");
    return ok({ roomId: "room-1", tasks: [] });
  } });
  const original = await runtime.call("session.open", { workspace: root, sessionId: "original-ticket", tabId: "same-tab", agentKind: "codex" });
  await mcpRequest(original, { method: "tools/list" });
  await runtime.call("session.revoke", { sessionId: "original-ticket" });
  const reattached = await runtime.call("session.open", { workspace: root, sessionId: "new-ticket", tabId: "same-tab", agentKind: "codex" });
  const before = calls.length;
  assert.equal(result(await call(reattached, "A2ARoomContext", { room: "room-1" })).structuredContent.roomId, "room-1");
  assert.deepEqual(calls.slice(before).map(request => [request.api, request.context.sessionId]),
    [["a2a.localReady", "new-ticket"], ["a2a.localRoom", "new-ticket"]]);
  const unsupported = await runtime.call("session.open", { workspace: root, sessionId: "unsupported-ticket", agentKind: "pi" });
  const failed = result(await call(unsupported, "A2ARoomTask", { room: "room-1", op: { op: "add", title: "Must not run" } }));
  assert.equal(failed.structuredContent.error.code, "A2A_AGENT_SESSION_REQUIRED");
  assert.equal(calls.at(-1).api, "a2a.localReady");
  assert.equal(calls.some(request => request.api === "a2a.localRoomTask"), false);
});

test("the same MCP session can discover local tools after its adapter becomes ready", async t => {
  const root = await realpath(await temporary(t)); let bound = false;
  const runtime = await host(t, root, { platform: () => bound ? ready : ok({ ready: false, protocolVersion: "1.0", reason: "adapterNotReady" }) });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "binding-ticket" });
  assert.equal((await mcpRequest(session, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), false);
  bound = true;
  assert.equal((await mcpRequest(session, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), true);
});

test("first tools discovery recovers a pending PTY binding using only bounded authorization handshake retries", async t => {
  const root = await realpath(await temporary(t)), calls = [];
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    return calls.length < 3 ? fail("A2A_AGENT_SESSION_INVALID", "Synthetic PTY binding pending") : ready;
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "pending-pty-ticket" });
  assert.equal((await mcpRequest(session, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), true);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(request => request.api === "a2a.localReady" && request.context.sessionId === "pending-pty-ticket"));
});

test("a stalled readiness reply respects the directory deadline and a fresh query can recover", { timeout: 15_000 }, async t => {
  const root = await realpath(await temporary(t)), calls = []; let release;
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : ready;
  } });
  t.after(() => release?.(ready));
  const session = await runtime.call("session.open", { workspace: root, sessionId: "stalled-readiness" });
  const started = performance.now();
  const reply = await mcpRequest(session, { method: "tools/list" });
  const elapsed = performance.now() - started;
  assert.equal(reply.status, 200);
  assert.ok(elapsed >= 2000 && elapsed < 3500, `directory settled in ${elapsed}ms; the 2500ms deadline includes the host wait`);
  assert.equal(reply.data.result.tools.some(tool => names.includes(tool.name)), false);
  assert.ok(reply.data.result.tools.some(tool => tool.name === "PluginTools"));
  assert.ok(reply.data.result.tools.some(tool => tool.name === "A2AConnections"));
  assert.equal(calls.length, 1);
  release(ready);
  const recovered = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
  assert.deepEqual(recovered.filter(tool => names.includes(tool.name)).map(tool => tool.name), names);
  assert.equal(calls.length, 2, "recovery requires a new authenticated handshake");
  assert.ok(calls.every(request => request.api === "a2a.localReady"));
});

test("readiness host waits and retry pauses share one deadline and late rejection cannot restart discovery", { timeout: 15_000 }, async t => {
  const root = await realpath(await temporary(t)), calls = []; let release;
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    if (calls.length < 3) return delay(500, fail("A2A_AGENT_SESSION_INVALID", "Synthetic binding pending"));
    if (calls.length === 3) return new Promise(resolve => { release = resolve; });
    return ready;
  } });
  t.after(() => release?.(ready));
  const session = await runtime.call("session.open", { workspace: root, sessionId: "retry-deadline" });
  const started = performance.now();
  const directory = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 2000 && elapsed < 3500, `all attempts settled in ${elapsed}ms under the same 2500ms deadline`);
  assert.equal(directory.some(tool => names.includes(tool.name)), false);
  assert.ok(directory.some(tool => tool.name === "PluginTools"));
  assert.equal(calls.length, 3);
  release(fail("A2A_AGENT_SESSION_INVALID", "Late binding error"));
  await delay(250);
  assert.equal(calls.length, 3, "the expired query cannot retry after its late host response");
  assert.equal((await mcpRequest(session, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), true);
  assert.equal(calls.length, 4);
  assert.ok(calls.every(request => request.api === "a2a.localReady"));
});

test("revoking readiness in flight rejects every directory result and late success cannot restore the old instance", async t => {
  const root = await realpath(await temporary(t)), calls = []; let release;
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : ready;
  } });
  t.after(() => release?.(ready));
  const session = await runtime.call("session.open", { workspace: root, sessionId: "revoked-readiness" });
  const pending = mcpRequest(session, { method: "tools/list" });
  assert.ok(await waitFor(() => release));
  await runtime.call("session.revoke", { sessionId: "revoked-readiness" });
  const reply = await pending;
  assert.equal(reply.data.result, undefined);
  assert.match(reply.data.error.message, /会话.*失效/);
  release(ready);
  assert.equal((await mcpRequest(session, { method: "tools/list" })).status, 401);
  const reopened = await runtime.call("session.open", { workspace: root, sessionId: "revoked-readiness" });
  assert.notEqual(reopened.token, session.token);
  assert.equal((await mcpRequest(reopened, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.api === "a2a.localReady"));
});

test("MCP cancellation stops readiness waiting while the live instance can refresh its directory", async t => {
  const root = await realpath(await temporary(t)), calls = []; let release;
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    return calls.length === 1 ? new Promise(resolve => { release = resolve; }) : ready;
  } });
  t.after(() => release?.(ready));
  const session = await runtime.call("session.open", { workspace: root, sessionId: "cancelled-readiness" });
  const pending = mcpRequest(session, { id: 9022, method: "tools/list" });
  assert.ok(await waitFor(() => release));
  assert.equal((await mcpRequest(session, { id: undefined, method: "notifications/cancelled", params: { requestId: 9022 } })).status, 202);
  const reply = await pending;
  assert.equal(reply.data.result, undefined);
  assert.match(reply.data.error.message, /取消/);
  release(ready);
  assert.equal((await mcpRequest(session, { method: "tools/list" })).data.result.tools.some(tool => tool.name === "A2AReportTask"), true);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(request => request.api === "a2a.localReady"), "directory cancellation must not cancel or retry business operations");
});

test("room brief updates preserve omitted fields, allow clearing, and use host-validated identity and a generated operation ID", async t => {
  const root = await realpath(await temporary(t)), calls = [];
  const runtime = await host(t, root, { platform: request => {
    if (request.api === "a2a.localReady") return ready;
    calls.push(request);
    assert.equal(request.api, "a2a.localRoomBrief");
    if (request.context.sessionId !== "coordinator-ticket") return fail("A2A_LOCAL_PERMISSION_OR_STATE", "Synthetic member permission restriction");
    return ok({ room: "Review", updated: true });
  } });
  const coordinator = await runtime.call("session.open", { workspace: root, sessionId: "coordinator-ticket" });
  const member = await runtime.call("session.open", { workspace: root, sessionId: "member-ticket" });
  assert.equal(result(await call(coordinator, "A2ARoomBrief", { room: "Review", focus: "Validate explicit reports" })).structuredContent.updated, true);
  assert.deepEqual(Object.keys(calls[0].args[0]).sort(), ["focus", "operationId", "room"]);
  assert.match(calls[0].args[0].operationId, /^[a-f0-9-]{36}$/);
  await call(coordinator, "A2ARoomBrief", { room: "Review", objective: "", constraints: [] });
  assert.deepEqual(calls[1].args[0].constraints, []); assert.equal(calls[1].args[0].objective, "");
  assert.notEqual(calls[0].args[0].operationId, calls[1].args[0].operationId);
  assert.equal(result(await call(member, "A2ARoomBrief", { room: "Review", focus: "Forbidden" })).structuredContent.error.code, "A2A_LOCAL_PERMISSION_OR_STATE");
  const count = calls.length;
  for (const args of [{ room: "Review" }, { room: "Review", focus: 3 }, { room: "Review", constraints: [3] },
    { room: "Review", constraints: Array(65).fill("x") }, { room: "Review", objective: "x".repeat(40000), focus: "y".repeat(40000) },
    { room: "Review", focus: "Valid", operationId: "forged" }, { room: "Review", focus: "Valid", owner: "coordinator-ticket" }]) {
    assert.equal(result(await call(coordinator, "A2ARoomBrief", args)).structuredContent.error.code, "INVALID_ARGUMENT");
  }
  assert.equal(calls.length, count);
});

test("two MCP Agent instances exchange assignments, explicit progress, input and artifacts through the published native boundary", async t => {
  const root = await realpath(await temporary(t)), entry = initial(), calls = [];
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    const args = request.args[0], owner = request.context.sessionId;
    if (request.api === "a2a.localReady") return ready;
    if (request.api === "a2a.sendMessage") {
      assert.equal(owner, "sender-ticket");
      if (args.taskHandle) {
        assert.equal(args.taskHandle, "sender-query"); entry.task.status = { state: "TASK_STATE_WORKING" };
        entry.task.history.push({ messageId: "follow-up", role: "ROLE_USER", parts: [{ text: args.text }] });
      }
      return ok(senderReply(entry));
    }
    if (request.api === "a2a.getTask") { assert.equal(owner, "sender-ticket"); return ok(senderReply(entry)); }
    assert.equal(owner, "recipient-ticket");
    if (request.api === "a2a.localTasks") return ok({ tasks: [structuredClone(entry)] });
    if (request.api === "a2a.localTask") { assert.equal(args.reportHandle, entry.reportHandle); return ok(structuredClone(entry)); }
    if (request.api === "a2a.localReport") {
      assert.equal(args.reportHandle, entry.reportHandle); assert.equal(args.generation, entry.generation);
      assert.match(args.operationId, /^[a-f0-9-]{36}$/);
      entry.task.status = { state: { working: "TASK_STATE_WORKING", inputRequired: "TASK_STATE_INPUT_REQUIRED", completed: "TASK_STATE_COMPLETED", failed: "TASK_STATE_FAILED" }[args.state],
        ...(args.text ? { message: { messageId: args.operationId, role: "ROLE_AGENT", parts: [{ text: args.text }] } } : {}) };
      if (args.artifacts) entry.task.artifacts = args.artifacts.map((artifact, index) => ({ artifactId: `artifact-${index}`, name: artifact.name, parts: [{ text: artifact.text }] }));
      return ok(structuredClone(entry));
    }
    return fail("A2A_API_UNSUPPORTED", request.api);
  } });
  const sender = await runtime.call("session.open", { workspace: root, sessionId: "sender-ticket", agentKind: "codex" });
  const recipient = await runtime.call("session.open", { workspace: root, sessionId: "recipient-ticket", agentKind: "claude" });
  const sent = result(await call(sender, "A2ASendMessage", { connectionId: "local:recipient-instance", text: "Do the assignment" })).structuredContent;
  assert.equal(sent.terminal, false);
  const task = result(await call(recipient, "A2ALocalTasks")).structuredContent.tasks[0];
  assert.equal(task.reportHandle, "recipient-report"); assert.notEqual(task.reportHandle, sent.taskHandle);
  assert.match(result(await call(recipient, "A2ALocalTask", { reportHandle: task.reportHandle })).structuredContent.instruction, /read-through-to-the-end$/);
  await call(recipient, "A2AReportTask", { reportHandle: task.reportHandle, generation: task.generation, state: "working", text: "Started" });
  assert.equal(result(await call(sender, "A2AGetTask", { taskHandle: sent.taskHandle })).structuredContent.task.status.state, "TASK_STATE_WORKING");
  await call(recipient, "A2AReportTask", { reportHandle: task.reportHandle, generation: task.generation, state: "inputRequired", text: "Which branch?" });
  assert.equal(result(await call(sender, "A2AGetTask", { taskHandle: sent.taskHandle })).structuredContent.task.status.state, "TASK_STATE_INPUT_REQUIRED");
  await call(sender, "A2ASendMessage", { connectionId: sent.connectionId, taskHandle: sent.taskHandle, text: "Use the current branch" });
  assert.equal(result(await call(recipient, "A2ALocalTask", { reportHandle: task.reportHandle })).structuredContent.task.history.at(-1).parts[0].text, "Use the current branch");
  await call(recipient, "A2AReportTask", { reportHandle: task.reportHandle, generation: task.generation, state: "completed", artifacts: [{ name: "Review", text: "Review completed" }] });
  const completed = result(await call(sender, "A2AGetTask", { taskHandle: sent.taskHandle })).structuredContent;
  assert.equal(completed.terminal, true); assert.equal(completed.task.artifacts[0].parts[0].text, "Review completed");
  const reports = calls.filter(request => request.api === "a2a.localReport");
  assert.equal(new Set(reports.map(request => request.args[0].operationId)).size, 3);
  assert.ok(calls.every(request => request.context.workspace === root));
  assert.ok(calls.filter(request => request.api === "a2a.localReport").every(request => request.context.sessionId === "recipient-ticket"));
});

test("Recipient instance, project and generation errors remain structured, including after session reopening", async t => {
  const root = await realpath(await temporary(t)), other = join(root, "other"); await mkdir(other);
  const entry = initial();
  const runtime = await host(t, root, { platform: request => {
    if (request.api === "a2a.localReady") return ready;
    const args = request.args[0];
    if (request.context.workspace !== root || request.context.sessionId !== "recipient-ticket" || args.reportHandle !== entry.reportHandle || args.generation !== 3) return fail("A2A_TASK_HANDLE_INVALID", "Synthetic owner or generation mismatch", { expectedGeneration: 3 });
    return ok({ ...entry, task: { ...entry.task, status: { state: "TASK_STATE_FAILED" } } });
  } });
  const recipient = await runtime.call("session.open", { workspace: root, sessionId: "recipient-ticket" });
  const another = await runtime.call("session.open", { workspace: root, sessionId: "another-ticket" });
  const foreign = await runtime.call("session.open", { workspace: other, sessionId: "foreign-ticket" });
  const args = { reportHandle: entry.reportHandle, generation: 3, state: "failed", text: "Unable to continue" };
  for (const session of [another, foreign]) assert.equal(result(await call(session, "A2AReportTask", args)).structuredContent.error.code, "A2A_TASK_HANDLE_INVALID");
  const stale = result(await call(recipient, "A2AReportTask", { ...args, generation: 2 }));
  assert.equal(stale.structuredContent.error.details.expectedGeneration, 3);
  assert.equal(result(await call(recipient, "A2AReportTask", args)).structuredContent.task.status.state, "TASK_STATE_FAILED");
  await runtime.call("session.revoke", { sessionId: "recipient-ticket" });
  assert.equal((await call(recipient, "A2AReportTask", args)).status, 401);
  const reopened = await runtime.call("session.open", { workspace: root, sessionId: "new-recipient-ticket" });
  assert.equal(result(await call(reopened, "A2AReportTask", args)).isError, true);
});

test("room context, task delegation, complete inbox messages and explicit question answers use the original business contract", async t => {
  const root = await realpath(await temporary(t)), calls = [], entry = initial(), full = "Message body: " + "全文".repeat(8000) + " final-message-marker";
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    const args = request.args[0];
    if (request.api === "a2a.localReady") return ready;
    if (request.api === "a2a.localRooms") return ok({ rooms: [{ id: "room-1", name: "Review", role: "foreman" }] });
    if (request.api === "a2a.localRoom") return ok({ roomId: "room-1", status: { iAmForeman: true, brief: { objective: "Review" } }, log: [], tasks: [{ id: "T1", generation: 7 }] });
    if (request.api === "a2a.localInbox") return ok({ schemaVersion: 1, messages: [{ messageId: "question-message", text: full, questions: [{ id: "question-1", text: "Which branch?", state: "open" }], reportHandle: entry.reportHandle, generation: entry.generation }], nextCursor: null });
    if (request.api === "a2a.localRoomSay") return ok({ room: "Review", message: "reply-message", recipients: ["Coordinator"], ask: false });
    if (request.api === "a2a.localRoomTask") {
      assert.match(args.requestId, /^[a-f0-9-]{36}$/);
      if (request.context.sessionId !== "coordinator-ticket") return fail("A2A_ARGUMENT_INVALID", "Synthetic role restriction");
      return ok({ roomId: "room-1", taskRef: { kind: "room_task", roomId: "room-1", id: "T2", generation: 1 }, task: { id: "T2", title: args.op.title }, agentReply: senderReply(entry) });
    }
    return fail("A2A_API_UNSUPPORTED", request.api);
  } });
  const coordinator = await runtime.call("session.open", { workspace: root, sessionId: "coordinator-ticket" });
  const member = await runtime.call("session.open", { workspace: root, sessionId: "member-ticket" });
  assert.equal(result(await call(coordinator, "A2ARooms")).structuredContent.rooms[0].id, "room-1");
  assert.equal(result(await call(coordinator, "A2ARoomContext", { room: "room-1", count: 30 })).structuredContent.tasks[0].generation, 7);
  const inbox = result(await call(member, "A2AInbox", { messageId: "question-message", cursor: "cursor-1", limit: 30 })).structuredContent;
  assert.equal(inbox.messages[0].text, full); assert.match(inbox.messages[0].text, /final-message-marker$/);
  await call(member, "A2ARoomSay", { room: "room-1", text: "Use the current branch", to: ["@coordinator"], replyTo: "question-message", topicId: "topic-1", answers: ["question-1"] });
  const reply = calls.find(request => request.api === "a2a.localRoomSay");
  assert.deepEqual(reply.args[0].answers, ["question-1"]); assert.equal(reply.args[0].replyTo, "question-message");
  assert.match(reply.args[0].operationId, /^[a-f0-9-]{36}$/);
  assert.equal(entry.task.status.state, "TASK_STATE_SUBMITTED", "a question reply does not complete an assignment");
  const add = { room: "room-1", op: { op: "add", title: "Review login", assignee: "Reviewer", outcome: "Report test failures", after: ["T1"] } };
  assert.equal(result(await call(coordinator, "A2ARoomTask", add)).structuredContent.agentReply.taskHandle, "sender-query");
  assert.equal(result(await call(member, "A2ARoomTask", add)).isError, true);
  await call(coordinator, "A2ARoomTask", { room: "room-1", op: { op: "reopen", task: "T1" }, expectedGeneration: 7 });
  assert.equal(calls.filter(request => request.api === "a2a.localRoomTask").at(-1).args[0].expectedGeneration, 7);
});

test("local collaboration rejects forged owners, bypass completion channels, stale-shape inputs and byte-limit violations before native dispatch", async t => {
  const root = await realpath(await temporary(t)), calls = [];
  const runtime = await host(t, root, { platform: request => { calls.push(request); return ok(initial()); } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "recipient-ticket" });
  const report = { reportHandle: "recipient-report", generation: 3, state: "working" };
  for (const key of ["owner", "workspace", "sessionId", "ticket", "url", "headers", "credential", "taskHandle", "taskId", "operationId", "requestId"]) {
    assert.equal(result(await call(session, "A2AReportTask", { ...report, [key]: "forged" })).structuredContent.error.code, "INVALID_ARGUMENT");
  }
  const cases = [
    ["A2AReportTask", { ...report, state: "completed" }],
    ["A2AReportTask", { ...report, state: "inputRequired", artifacts: [{ text: "An artifact cannot ask for input" }] }],
    ["A2AReportTask", { ...report, state: "failed" }],
    ["A2AReportTask", { ...report, generation: 1.5 }],
    ["A2AReportTask", { ...report, state: "TASK_STATE_COMPLETED", text: "Invalid report enum" }],
    ["A2AReportTask", { ...report, text: "中".repeat(22000) }],
    ["A2AReportTask", { ...report, text: "a".repeat(40000), artifacts: [{ text: "b".repeat(40000) }] }],
    ["A2AReportTask", { ...report, artifacts: [{ name: "x".repeat(121), text: "result" }] }],
    ["A2AReportTask", { ...report, artifacts: Array.from({ length: 17 }, () => ({ text: "result" })) }],
    ["A2ARoomTask", { room: "room-1", op: { op: "done", task: "T1", result: "Bypass" } }],
    ["A2ARoomTask", { room: "room-1", op: { op: "start", task: "T1" } }],
    ["A2ARoomTask", { room: "room-1", op: { op: "assign", task: "T1", assignee: "Reviewer" } }],
    ["A2ARoomTask", { room: "room-1", op: { op: "add", title: "x".repeat(81) } }],
    ["A2ARoomTask", { room: "room-1", op: { op: "add", title: "Review", owner: "forged" } }],
    ["A2AInbox", { limit: 31 }], ["A2AInbox", { limit: 0 }], ["A2ARoomContext", { room: "room-1", count: 51 }],
    ["A2ARoomSay", { room: "room-1", text: "x".repeat(4001) }],
    ["A2ARoomSay", { room: "room-1", text: "Question", questions: ["x".repeat(4001)] }],
    ["A2ARoomSay", { room: "room-1", text: "Question", answers: [3] }],
  ];
  for (const [name, args] of cases) assert.equal(result(await call(session, name, args)).structuredContent.error.code, "INVALID_ARGUMENT", name);
  assert.equal(calls.length, 0);
});

test("cancelling room delegation preserves its unknown outcome, cancels only the native request and discards late results", async t => {
  const root = await realpath(await temporary(t)), calls = []; let started, release;
  const runtime = await host(t, root, { platform: request => {
    if (request.api === "a2a.localReady") return ready;
    calls.push(request);
    if (request.api === "a2a.localRoomTask") { started = request; return new Promise(resolve => { release = resolve; }); }
    return ok(true);
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "coordinator-ticket" });
  const pending = call(session, "A2ARoomTask", { room: "room-1", op: { op: "add", title: "Review", assignee: "Reviewer" } }, 9021);
  assert.ok(await waitFor(() => started));
  await mcpRequest(session, { id: undefined, method: "notifications/cancelled", params: { requestId: 9021 } });
  const cancelled = result(await pending);
  assert.equal(cancelled.isError, true); assert.equal(cancelled.structuredContent.error.details.outcomeUnknown, true);
  assert.equal(cancelled.structuredContent.error.retryable, false);
  const stop = calls.find(request => request.api === "a2a.cancelRequest");
  assert.equal(stop.args[0].requestId, started.args[0].requestId); assert.deepEqual(stop.context, started.context);
  assert.equal(calls.some(request => request.api === "a2a.cancelTask"), false);
  release(ok({ roomId: "room-1", task: { id: "T1" } }));
});
