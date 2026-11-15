import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { host, temporary, waitFor } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";
import { a2aTool } from "../../src-tauri/src/plugins/node/mcp-a2a-tools.mjs";

const names = ["A2AConnections", "A2AAgentCard", "A2ASendMessage", "A2AGetTask", "A2ACancelTask"];
const ok = value => ({ ok: true, value });
const fail = (code, message, details = null) => ({ ok: false, error: { code, message, retryable: false, details, params: {} } });
const task = (state = "TASK_STATE_WORKING") => ({ id: "remote-task", contextId: "remote-context", status: { state } });
const taskReply = (state = "TASK_STATE_WORKING") => ({ kind: "task", connectionId: "saved-connection", taskHandle: "host-handle", task: task(state), terminal: state === "TASK_STATE_COMPLETED" || state === "TASK_STATE_CANCELED" });
const messageReply = { kind: "message", connectionId: "saved-connection", message: { messageId: "reply-1", role: "ROLE_AGENT", parts: [{ text: "Immediate reply" }] } };
const tool = (session, name, args = {}, id) => mcpRequest(session, { ...(id === undefined ? {} : { id }), method: "tools/call", params: { name, arguments: args } });
const result = response => response.data.result;

test("every declared native A2A error code has Chinese and English UI feedback", async () => {
  const directory = new URL("../../src-tauri/src/a2a/", import.meta.url);
  const names = (await readdir(directory, { recursive: true })).filter(name => name.endsWith(".rs") && !/(^|\/)tests(?:\/|\.rs$)/.test(name));
  const codes = new Set((await Promise.all(names.map(name => readFile(new URL(name, directory), "utf8"))))
    .flatMap(source => [...source.matchAll(/"(A2A_[A-Z_]+)"/g)].map(match => match[1])));
  codes.add("A2A_AGENT_SESSION_INVALID"); assert.ok(codes.size);
  for (const locale of ["zh-CN", "en"]) {
    const catalog = JSON.parse(await readFile(new URL(`../../src/i18n/locales/${locale}/a2a.json`, import.meta.url), "utf8"));
    for (const code of codes) assert.equal(typeof catalog.errors[code], "string", `${locale}: ${code}`);
  }
});

test("A2A tools are in the real MCP directory and connection discovery exposes only public metadata", async t => {
  const root = await temporary(t), calls = [];
  const runtime = await host(t, root, { platform: request => {
    if (request.api === "a2a.localReady") return ok({ ready: false, protocolVersion: "1.0" });
    calls.push(request);
    return ok([{ id: "saved-connection", name: "Reviewer", rootPath: "/private/project", cardUrl: "https://example.invalid/card", revision: "r1",
      credential: "never-return-this", auth: { kind: "bearer", headerName: null, hasCredential: true, value: "never-return-this" } }]);
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "application-ticket", agentKind: "codex", agentSession: { agent: "codex", id: "native-history" } });
  const listing = await mcpRequest(session, { method: "tools/list" });
  const a2a = listing.data.result.tools.filter(item => names.includes(item.name));
  assert.deepEqual(a2a.map(item => item.name), names);
  for (const item of a2a) assert.equal(item.inputSchema.additionalProperties, false);
  const initialized = await mcpRequest(session, { method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.match(initialized.data.result.instructions, /A2AConnections/);
  const discovered = result(await tool(session, "A2AConnections"));
  assert.deepEqual(discovered.structuredContent, { connections: [{ id: "saved-connection", name: "Reviewer", auth: { kind: "bearer", headerName: null, hasCredential: true } }] });
  assert.equal(discovered.isError, undefined);
  assert.doesNotMatch(JSON.stringify(discovered), /never-return-this|private\/project|native-history/);
  assert.deepEqual(calls[0].context, { workspace: await realpath(root), sessionId: "application-ticket" });
  assert.deepEqual(calls[0].args, [{}]);
});

test("A2A tools forward discovery, message/task, follow-up, history and remote cancellation with fresh internal IDs", async t => {
  const root = await temporary(t), calls = [];
  const discovery = { card: { name: "Fixture", skills: [] }, interfaces: [{ url: "http://127.0.0.1/rpc", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], selectedInterface: null, issue: null };
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    if (request.api === "a2a.agentCard") return ok(discovery);
    if (request.api === "a2a.sendMessage") return ok(request.args[0].text === "instant" ? messageReply : taskReply());
    if (request.api === "a2a.getTask") return ok({ ...taskReply("TASK_STATE_COMPLETED"), task: { ...task("TASK_STATE_COMPLETED"), artifacts: [{ artifactId: "answer", parts: [{ text: "Finished" }] }] } });
    if (request.api === "a2a.cancelTask") return ok(taskReply("TASK_STATE_CANCELED"));
    return fail("UNSUPPORTED", request.api);
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "owner-ticket" });
  assert.deepEqual(result(await tool(session, "A2AAgentCard", { connectionId: "saved-connection" })).structuredContent, discovery);
  const instant = result(await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: "instant" }));
  assert.deepEqual(instant.structuredContent, messageReply); assert.equal(instant.structuredContent.taskHandle, undefined);
  const working = result(await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: "task" })).structuredContent;
  assert.equal(working.terminal, false); assert.equal(working.task.status.state, "TASK_STATE_WORKING");
  await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: "follow-up", taskHandle: working.taskHandle });
  const completed = result(await tool(session, "A2AGetTask", { taskHandle: working.taskHandle, historyLength: 2 })).structuredContent;
  assert.equal(completed.terminal, true); assert.equal(completed.task.artifacts[0].parts[0].text, "Finished");
  assert.equal(result(await tool(session, "A2ACancelTask", { taskHandle: working.taskHandle })).structuredContent.task.status.state, "TASK_STATE_CANCELED");
  assert.deepEqual(calls.map(item => item.api), ["a2a.agentCard", "a2a.sendMessage", "a2a.sendMessage", "a2a.sendMessage", "a2a.getTask", "a2a.cancelTask"]);
  assert.equal(new Set(calls.map(item => item.args[0].requestId)).size, calls.length);
  assert.equal(calls[3].args[0].taskHandle, "host-handle"); assert.equal(calls[4].args[0].historyLength, 2);
  for (const request of calls) {
    assert.deepEqual(request.context, { workspace: await realpath(root), sessionId: "owner-ticket" });
    assert.match(request.args[0].requestId, /^[a-f0-9-]{36}$/);
    assert.equal(request.args[0].url, undefined); assert.equal(request.args[0].taskId, undefined);
  }
});

test("A2A tools reject forged identity, targets, credentials and remote IDs before invoking the host", async t => {
  const root = await temporary(t), calls = [];
  const runtime = await host(t, root, { platform: request => { calls.push(request); return ok(messageReply); } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "trusted-ticket" });
  for (const key of ["url", "workspace", "rootPath", "sessionId", "owner", "generation", "requestId", "credential", "headers", "taskId"]) {
    const invalid = result(await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: "task", [key]: "forged" }));
    assert.equal(invalid.isError, true, key); assert.equal(invalid.structuredContent.error.code, "INVALID_ARGUMENT", key);
  }
  for (const historyLength of [-1, 21, 1.5, "2"]) assert.equal(result(await tool(session, "A2AGetTask", { taskHandle: "handle", historyLength })).isError, true);
  assert.equal(result(await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: String.fromCodePoint(0x4e00).repeat(22000) })).isError, true);
  assert.equal(calls.length, 0);
});

test("A2A structured errors preserve TaskNotCancelable and uncertain SendMessage outcomes without retries", async t => {
  const root = await temporary(t), calls = [];
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    return request.api === "a2a.cancelTask" ? fail("A2A_RPC_ERROR", "Task cannot be cancelled", { rpcCode: -32002 })
      : fail("TIMEOUT", "Send outcome unknown", { outcomeUnknown: true });
  } });
  const session = await runtime.call("session.open", { workspace: root, sessionId: "owner-ticket" });
  const cancelled = result(await tool(session, "A2ACancelTask", { taskHandle: "handle" }));
  assert.equal(cancelled.isError, true); assert.equal(cancelled.structuredContent.error.details.rpcCode, -32002);
  const sent = result(await tool(session, "A2ASendMessage", { connectionId: "saved-connection", text: "task" }));
  assert.equal(sent.isError, true); assert.equal(sent.structuredContent.error.details.outcomeUnknown, true);
  assert.equal(calls.length, 2);
});

test("MCP cancellation aborts only the caller's local A2A request and discards late success", async t => {
  const root = await temporary(t), calls = []; let release, started;
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    if (request.api === "a2a.sendMessage" && request.context.sessionId === "first-ticket") {
      started = request; return new Promise(resolve => { release = resolve; });
    }
    return ok(request.api === "a2a.cancelRequest" ? true : messageReply);
  } });
  const first = await runtime.call("session.open", { workspace: root, sessionId: "first-ticket" });
  const second = await runtime.call("session.open", { workspace: root, sessionId: "second-ticket" });
  const pending = tool(first, "A2ASendMessage", { connectionId: "saved-connection", text: "slow task" }, 7001);
  assert.ok(await waitFor(() => started));
  await mcpRequest(first, { id: undefined, method: "notifications/cancelled", params: { requestId: 7001 } });
  const failed = result(await pending);
  assert.equal(failed.isError, true); assert.equal(failed.structuredContent.error.code, "CANCELLED");
  assert.equal(failed.structuredContent.error.details.outcomeUnknown, true);
  assert.equal(failed.structuredContent.error.retryable, false);
  assert.ok(await waitFor(() => calls.some(item => item.api === "a2a.cancelRequest")));
  const local = calls.find(item => item.api === "a2a.cancelRequest");
  assert.equal(local.args[0].requestId, started.args[0].requestId); assert.deepEqual(local.context, started.context);
  assert.notEqual(local.args[0].requestId, "7001");
  assert.equal(calls.some(item => item.api === "a2a.cancelTask"), false);
  release(ok(taskReply("TASK_STATE_COMPLETED")));
  assert.deepEqual(result(await tool(second, "A2ASendMessage", { connectionId: "saved-connection", text: "other task" })).structuredContent, messageReply);
});

test("project and Agent instance ownership comes from each authenticated MCP connection", async t => {
  const root = await temporary(t), other = join(root, "other"); await mkdir(other);
  const calls = [], handles = new Map();
  const runtime = await host(t, root, { platform: request => {
    calls.push(request);
    if (request.api === "a2a.sendMessage") {
      handles.set("host-handle", request.context); return ok(taskReply());
    }
    const expected = handles.get(request.args[0].taskHandle);
    return expected?.workspace === request.context.workspace && expected?.sessionId === request.context.sessionId
      ? ok(taskReply()) : fail("A2A_TASK_NOT_FOUND", "Task is not owned by this Agent instance");
  } });
  const first = await runtime.call("session.open", { workspace: root, sessionId: "first-generation" });
  const second = await runtime.call("session.open", { workspace: other, sessionId: "other-ticket" });
  await tool(first, "A2ASendMessage", { connectionId: "saved-connection", text: "task" });
  assert.equal(result(await tool(second, "A2ACancelTask", { taskHandle: "host-handle" })).isError, true);
  await runtime.call("session.revoke", { sessionId: "first-generation" });
  assert.equal((await tool(first, "A2AGetTask", { taskHandle: "host-handle" })).status, 401);
  const reopened = await runtime.call("session.open", { workspace: root, sessionId: "next-generation" });
  assert.equal(result(await tool(reopened, "A2AGetTask", { taskHandle: "host-handle" })).isError, true);
  assert.deepEqual(calls.map(item => item.context.sessionId), ["first-generation", "other-ticket", "next-generation"]);
});

test("A2A cancellation during host invocation is observed even if a success arrives immediately", async () => {
  const controller = new AbortController(), calls = [];
  const context = { workspace: "/project", sessionId: "ticket", abort: controller };
  const manager = { broker: { platform: async request => {
    calls.push(request);
    if (request.api === "a2a.sendMessage") controller.abort();
    return ok(messageReply);
  } } };
  const response = await a2aTool(manager, { name: "A2ASendMessage", arguments: { connectionId: "saved-connection", text: "task" } }, context);
  assert.equal(response.isError, true); assert.equal(response.structuredContent.error.code, "CANCELLED");
  assert.equal(response.structuredContent.error.details.outcomeUnknown, true);
  assert.deepEqual(calls.map(item => item.api), ["a2a.sendMessage", "a2a.cancelRequest"]);
  assert.equal(calls[0].args[0].requestId, calls[1].args[0].requestId);
});
