import assert from "node:assert/strict";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { temporary } from "./support.mjs";
import { readSessionContext, bindToolContext } from "../../src-tauri/src/plugins/node/session-context.mjs";

async function fixture(t, agent = "codex") {
  const root = await temporary(t), historyRoot = join(root, "history"), workspace = join(root, "workspace");
  await mkdir(historyRoot); await mkdir(workspace);
  const context = { sessionId: "connection-ticket", agentKind: agent, historyRoot, workspace,
    agentSession: { agent, id: "11111111-1111-4111-8111-111111111111" } };
  const file = join(historyRoot, agent === "codex" ? `rollout-2026-${context.agentSession.id}.jsonl` : `${context.agentSession.id}.jsonl`);
  const write = (lines) => writeFile(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return { context, file, write, root };
}
test("Codex metadata binds once and cannot switch an authenticated connection to another session", () => {
  const context = { sessionId: "ticket", agentKind: "codex" };
  const request = { method: "tools/call", params: { _meta: { threadId: "11111111-1111-4111-8111-111111111111" } } };
  assert.equal(bindToolContext(context, request).agentSession.id, request.params._meta.threadId);
  assert.throws(() => bindToolContext(context, { ...request, params: { _meta: { threadId: "22222222-2222-4222-8222-222222222222" } } }), { code: "SESSION_MISMATCH" });
  assert.throws(() => bindToolContext({ agentKind: "codex" }, { ...request, params: { _meta: { threadId: "../other" } } }), { code: "INVALID_ARGUMENT" });
});
test("Codex context reads only the bound transcript and strips plugin tool echoes", async (t) => {
  const { context, write } = await fixture(t);
  await write([
    { type: "session_meta", payload: { id: context.agentSession.id, cwd: context.workspace } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "只读取这个会话" }] } },
    { type: "response_item", payload: { type: "function_call", name: "mcp__belfry_plugins__my_tool", call_id: "call-1", arguments: "echo input" } },
    { type: "response_item", payload: { type: "function_call_output", call_id: "call-1", output: "echo output" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "确认" }] } },
  ]);
  const result = await readSessionContext(context, "my_tool");
  assert.equal(result.sessionId, context.agentSession.id);
  assert.deepEqual(result.messages.map((item) => item.content), ["只读取这个会话", "确认"]);
  assert.equal(result.truncated, false);
  await assert.rejects(readSessionContext({ ...context, workspace: context.historyRoot }, "my_tool"), { code: "UNAVAILABLE" });
});
test("Claude text and tool results preserve roles and reject another session", async (t) => {
  const { context, write } = await fixture(t, "claude");
  const meta = { sessionId: context.agentSession.id, cwd: context.workspace };
  await write([
    { ...meta, type: "user", message: { content: "问题" } },
    { ...meta, type: "assistant", message: { content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "note.txt" } }] } },
    { ...meta, type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: [{ type: "text", text: "内容" }] }] } },
    { ...meta, sessionId: "other", type: "user", message: { content: "不属于这里" } },
  ]);
  const result = await readSessionContext(context, "my_tool");
  assert.equal(result.messages.at(-1).role, "tool");
  assert.equal(result.messages.at(-1).content, "内容");
  assert.ok(!JSON.stringify(result).includes("不属于这里"));
});
test("huge transcript lines remain bounded and no session is guessed from the workspace", async (t) => {
  const { context, write, root } = await fixture(t);
  await write([
    { type: "session_meta", payload: { id: context.agentSession.id, cwd: context.workspace } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_image", image_url: "a".repeat(3 * 1024 * 1024) }] } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "保留末尾文本" }] } },
  ]);
  const result = await readSessionContext(context, "my_tool");
  assert.equal(result.truncated, true);
  assert.equal(result.messages.at(-1).content, "保留末尾文本");
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024);
  await assert.rejects(readSessionContext({ ...context, agentSession: undefined }, "my_tool"), { code: "UNAVAILABLE" });
  await symlink(context.historyRoot, join(root, "linked"), "dir");
  await assert.rejects(readSessionContext({ ...context, agentSession: { agent: "codex", id: "missing" } }, "my_tool"), { code: "UNAVAILABLE" });
});
