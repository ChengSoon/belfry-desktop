import assert from "node:assert/strict";
import test from "node:test";
import { host, temporary, waitFor } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";

const native = (id, agent = "codex") => ({ agent, id });
const request = (id) => ({ method: "tools/call", params: { name: "PluginTools", _meta: { threadId: id } } });

test("authenticated Codex metadata publishes the exact identity once, without Hook configuration", async (t) => {
  const root = await temporary(t), events = [];
  const runtime = await host(t, root, { event: (event) => { if (event.name === "sessionIdentity") events.push(event); } });
  const session = await runtime.call("session.open", { workspace: root, agentKind: "codex", sessionId: "ticket" });
  await mcpRequest(session, { method: "tools/list" });
  await mcpRequest(session, { method: "tools/call", params: { name: "PluginTools", arguments: { threadId: "not-metadata" } } });
  assert.deepEqual(events, []);
  await mcpRequest(session, request("native-main"));
  assert.ok(await waitFor(() => events.length === 1));
  assert.deepEqual(events[0], { type: "event", name: "sessionIdentity", sessionId: "ticket", session: native("native-main") });
  await mcpRequest(session, request("native-main"));
  const changed = await mcpRequest(session, request("another-thread"));
  assert.match(changed.data.error.message, /不匹配/);
  const invalid = await mcpRequest(session, request("../other"));
  assert.match(invalid.data.error.message, /无效/);
  assert.equal(events.length, 1);
});

test("parallel and revoked MCP tickets cannot publish an identity for another terminal", async (t) => {
  const root = await temporary(t), events = [];
  const runtime = await host(t, root, { event: (event) => { if (event.name === "sessionIdentity") events.push(event); } });
  const first = await runtime.call("session.open", { workspace: root, agentKind: "codex", sessionId: "first" });
  const second = await runtime.call("session.open", { workspace: root, agentKind: "codex", sessionId: "second" });
  await Promise.all([mcpRequest(first, request("native-first")), mcpRequest(second, request("native-second"))]);
  assert.ok(await waitFor(() => events.length === 2));
  assert.deepEqual(Object.fromEntries(events.map((event) => [event.sessionId, event.session])), {
    first: native("native-first"), second: native("native-second"),
  });
  await runtime.call("session.revoke", { sessionId: "first" });
  assert.equal((await mcpRequest(first, request("native-first"))).status, 401);
  await mcpRequest(second, request("native-second"));
  assert.equal(events.length, 2);
});

test("a known launch identity is published before the first tool call and validated against its agent", async (t) => {
  const root = await temporary(t), events = [];
  const runtime = await host(t, root, { event: (event) => { if (event.name === "sessionIdentity") events.push(event); } });
  await runtime.call("session.open", { workspace: root, agentKind: "claude", agentSession: native("native-claude", "claude"), sessionId: "early" });
  assert.ok(await waitFor(() => events.length === 1));
  assert.deepEqual(events[0].session, native("native-claude", "claude"));
  assert.equal(events[0].sessionId, "early");
  await assert.rejects(runtime.call("session.open", {
    workspace: root, agentKind: "claude", agentSession: native("wrong-agent"), sessionId: "invalid",
  }), { code: "INVALID_ARGUMENT" });
  assert.equal(events.length, 1);
});
