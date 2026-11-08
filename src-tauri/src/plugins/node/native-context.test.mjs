import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindToolContext, readSessionContext } from "./session-context.mjs";
import { PluginModels } from "./models.mjs";
import { McpServer } from "./mcp-server.mjs";
import { qualified } from "./mcp-names.mjs";

const roots = [], servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await server.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(agent) {
  const root = await mkdtemp(join(tmpdir(), "belfry-native-context-")); roots.push(root);
  const workspace = join(root, "workspace"), historyRoot = join(root, "history");
  await mkdir(workspace); await mkdir(historyRoot);
  const id = "native-a", toolName = qualified("example", "inspect");
  const prefix = { opencode: "belfry_plugins_", antigravity: "mcp_belfry_plugins_", kimi: "mcp__belfry_plugins__" }[agent];
  const lines = [
    { type: "session_meta", belfrySession: { agent, id, cwd: workspace } },
    { type: "user", sessionId: id, message: { content: "Visible request" } },
    { type: "user", sessionId: "native-b", message: { content: "Foreign private request" } },
    { type: "assistant", sessionId: id, message: { model: "native-model", content: [{ type: "tool_use", name: prefix + toolName, id: "own", input: { secret: "own tool input" } }, { type: "tool_use", name: "read_file", id: "read", input: { path: "file" } }] } },
    { type: "user", sessionId: id, message: { content: [{ type: "tool_result", tool_use_id: "own", content: "own tool result" }, { type: "tool_result", tool_use_id: "read", content: "File body" }] } },
    { type: "assistant", sessionId: id, belfryAuxiliary: true, message: { model: "unknown", content: [] } },
  ];
  const file = join(historyRoot, createHash("sha256").update(id).digest("hex") + ".jsonl");
  await writeFile(file, lines.map(line => JSON.stringify(line) + "\n").join(""));
  return { agentKind: agent, agentSession: { agent, id }, workspace, historyRoot, file, lines, sessionId: "ticket-a", toolName: "inspect", expired: false };
}

it.each(["antigravity", "opencode", "kimi"])("reads only the verified %s session and excludes the invoking tool", async agent => {
  const context = await fixture(agent);
  const result = await readSessionContext(context, qualified("example", "inspect"), async id => `provider/${id}`);
  expect(result.sessionId).toBe("native-a"); expect(result.modelKey).toBe("provider/native-model");
  expect(result.messages.map(message => message.content).join("\n")).toBe('Visible request\n{"path":"file"}\nFile body');
  context.lines[0].belfrySession.cwd = context.historyRoot;
  await writeFile(context.file, context.lines.map(line => JSON.stringify(line) + "\n").join(""));
  await expect(readSessionContext(context, qualified("example", "inspect"))).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

it("rejects a native session switch and an identity missing at tool start", async () => {
  const context = await fixture("kimi");
  const models = new PluginModels(async () => ({ agentSession: { agent: "kimi", id: "native-b" }, historyRoot: context.historyRoot }));
  const entry = { manifest: { id: "example", permissions: ["session.read"] } };
  await expect(models.session(entry, context)).rejects.toMatchObject({ code: "SESSION_MISMATCH" });
  await expect(models.session(entry, { ...context, agentSession: null })).rejects.toMatchObject({ code: "UNAVAILABLE" });
});

it.each(["antigravity", "opencode"])("uses %s MCP metadata only to corroborate daemon identity", agent => {
  const context = { agentKind: agent, agentSession: { agent, id: "native-a" } };
  const key = agent === "opencode" ? "ai.opencode/sessionID" : "conversation_id";
  const request = id => ({ method: "tools/call", params: { _meta: { [key]: id } } });
  expect(bindToolContext(context, request("native-a"))).toBe(context);
  expect(() => bindToolContext(context, request("native-b"))).toThrow(/SESSION_MISMATCH/);
  const unbound = { agentKind: agent };
  bindToolContext(unbound, request("native-a")); expect(unbound.agentSession).toBeUndefined();
});

it("pins native identity separately for concurrent MCP calls", async () => {
  const fixtureA = await fixture("opencode");
  let current = "native-a", release;
  const held = new Promise(resolve => { release = resolve; }), contexts = [];
  const manager = { event() {}, broker: { browser: { revoke: async () => {} }, platform: async () => ({ agentSession: { agent: "opencode", id: current }, historyRoot: fixtureA.historyRoot }) },
    catalog: () => ({ tools: [{ pluginId: "example", name: "inspect" }], skills: [] }),
    async invoke(_kind, input) { contexts.push(input.context); if (contexts.length === 1) await held; return { text: input.context.agentSession.id }; } };
  const server = await new McpServer(manager).start(); servers.push(server);
  await server.open({ sessionId: "ticket", agentKind: "opencode", workspace: fixtureA.workspace });
  const context = [...server.sessions.values()][0];
  const message = id => ({ id, method: "tools/call", params: { name: qualified("example", "inspect") } });
  const first = server.execute(context, message(1), new EventEmitter());
  try {
    await vi.waitFor(() => expect(contexts).toHaveLength(1));
    current = "native-b";
    await server.execute(context, message(2), new EventEmitter());
    expect(contexts[0].agentSession.id).toBe("native-a"); expect(contexts[1].agentSession.id).toBe("native-b");
    expect(context.agentSession.id).toBe("native-b");
  } finally { release(); await first; }
});
