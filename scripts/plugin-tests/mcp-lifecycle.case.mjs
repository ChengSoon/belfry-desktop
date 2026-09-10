import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";

test("PI tool images reach the Agent as MCP images without repeating base64 in text", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Zq8AAAAASUVORK5CYII=";
  const entry = await plugin(root, "mine.images", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "capture", description: "capture", execute: () => ({ ok: true, text: "A screenshot", images: [{ mimeType: "image/png", data: "${data}" }] })
  });`, manifest: { permissions: ["agent.tool.register"] } });
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "images" });
  const catalog = await mcpRequest(session, { method: "tools/list" });
  const tool = catalog.data.result.tools.find((item) => item.description.includes("capture"));
  const { data: reply } = await mcpRequest(session, { method: "tools/call", params: { name: tool.name } });
  assert.deepEqual(reply.result.content.find((item) => item.type === "image"), { type: "image", mimeType: "image/png", data });
  assert.match(reply.result.content[0].text, /A screenshot/);
  assert.ok(!reply.result.content[0].text.includes(data));
});

test("MCP cancellation reaches the worker AbortSignal and preserves the Agent connection", async (t) => {
  const root = await temporary(t); let ready, noticed;
  const started = new Promise((resolve) => { ready = resolve; });
  const aborted = new Promise((resolve) => { noticed = resolve; });
  const runtime = await host(t, root, { platform: () => { ready(); return null; },
    event: (event) => { if (event.name === "log" && event.message === "noticed abort") noticed(); } });
  const entry = await plugin(root, "mine.cancel", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "wait", description: "wait for cancellation", execute: async (_, ctx) => {
      if (!(ctx.signal instanceof AbortSignal)) throw new Error("missing AbortSignal");
      const stopped = new Promise(resolve => ctx.signal.addEventListener("abort", () => { ctx.log("noticed abort"); resolve("late value"); }, { once: true }));
      await pi.ui.showToast("ready"); return stopped;
    }
  });`, manifest: { permissions: ["agent.tool.register"] } });
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "cancel" });
  const catalog = await mcpRequest(session, { method: "tools/list" });
  const tool = catalog.data.result.tools.find((item) => item.description.includes("wait for cancellation"));
  const pending = mcpRequest(session, { id: "cancel-this", method: "tools/call", params: { name: tool.name } });
  const initial = await Promise.race([started.then(() => "ready"), pending.then(() => "returned early")]);
  assert.equal(initial, "ready");
  const cancel = await mcpRequest(session, { id: undefined, method: "notifications/cancelled", params: { requestId: "cancel-this" } });
  assert.equal(cancel.status, 202);
  const result = (await pending).data.result;
  assert.equal(result.isError, true); assert.match(result.content[0].text, /取消/);
  await aborted;
  assert.equal((await mcpRequest(session, { method: "tools/list" })).status, 200);
});

test("revoking a session suppresses even successful values returned by a running worker", async (t) => {
  const root = await temporary(t); let release, ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const runtime = await host(t, root, { platform: () => new Promise((resolve) => { release = resolve; ready(); }) });
  t.after(() => release?.(null));
  const entry = await plugin(root, "mine.late", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "late", description: "late value", execute: async () => { await pi.ui.showToast("ready"); return "private late value"; }
  });`, manifest: { permissions: ["agent.tool.register"] } });
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "late" });
  const catalog = await mcpRequest(session, { method: "tools/list" });
  const tool = catalog.data.result.tools.find((item) => item.description.includes("late value"));
  const pending = mcpRequest(session, { method: "tools/call", params: { name: tool.name } });
  await started;
  await runtime.call("session.revoke", { sessionId: "late" }); release(null);
  const result = (await pending).data.result;
  assert.equal(result.isError, true); assert.ok(!JSON.stringify(result).includes("private late value"));
});

test("real MCP metadata binds transcript reads and the public worker context to one Codex session", async (t) => {
  const root = await temporary(t), historyRoot = join(root, "history"); await mkdir(historyRoot);
  const id = "11111111-1111-4111-8111-111111111111";
  await writeFile(join(historyRoot, `rollout-2026-${id}.jsonl`), [
    { type: "session_meta", payload: { id, cwd: root } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Only this conversation" }] } },
  ].map((value) => JSON.stringify(value)).join("\n") + "\n");
  const entry = await plugin(root, "mine.context", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "context", description: "bound context", execute: async (_, context) => ({ sessionId: context.sessionId,
      historyRoot: context.historyRoot ?? null, transcript: await pi.session.getLlmContext() })
  });`, manifest: { permissions: ["agent.tool.register", "session.read"] } });
  const runtime = await host(t, root); await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, historyRoot, agentKind: "codex", sessionId: "private-connection" });
  const catalog = await mcpRequest(session, { method: "tools/list" });
  const tool = catalog.data.result.tools.find((item) => item.description.includes("bound context"));
  const request = { method: "tools/call", params: { name: tool.name, _meta: { threadId: id } } };
  const result = JSON.parse((await mcpRequest(session, request)).data.result.content[0].text);
  assert.equal(result.sessionId, id); assert.equal(result.historyRoot, null);
  assert.deepEqual(result.transcript.messages.map((message) => message.content), ["Only this conversation"]);
  request.params._meta.threadId = "other-session";
  assert.match((await mcpRequest(session, request)).data.error.message, /不匹配/);
});
