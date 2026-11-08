import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "./mcp-server.mjs";
import { qualified } from "./mcp-names.mjs";

function bridge(environment) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("./mcp-stdio.mjs", import.meta.url))], { env: { ...process.env, ...environment }, stdio: ["pipe", "pipe", "pipe"] });
  const waiting = new Map(); let serial = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => { const message = JSON.parse(line); if (waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); } });
  return { async request(method, params = {}) {
    const id = ++serial;
    const response = new Promise(resolve => waiting.set(id, resolve));
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    let timer;
    try { return await Promise.race([response, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("MCP test timed out")), 2000); })]); }
    finally { clearTimeout(timer); waiting.delete(id); }
  }, async close() { lines.close(); if (child.exitCode === null) { const exit = once(child, "exit"); child.kill(); await exit; } } };
}

it.each(["antigravity", "opencode", "kimi"])("forwards %s native stdio MCP through Belfry's authenticated plugin server", async agent => {
  const workspace = await mkdtemp(join(tmpdir(), "belfry-native-mcp-"));
  const calls = [];
  const manager = { event() {}, catalog: () => ({ tools: [{ pluginId: "test", pluginName: "Test", name: "echo", description: "Echo test input", schema: { type: "object", properties: { text: { type: "string" } } } }], skills: [] }),
    broker: { browser: { revoke: async () => {} }, platform: async () => ({ agentSession: { agent, id: "native-test" }, historyRoot: workspace }) },
    async invoke(_kind, input) { calls.push(input); return input.args.text; } };
  const server = await new McpServer(manager).start();
  let client;
  try {
    const ticket = await server.open({ sessionId: "test-ticket", agentKind: agent, workspace });
    client = bridge({ BELFRY_PLUGIN_MCP_URL: ticket.url, BELFRY_PLUGIN_MCP_TOKEN: ticket.token });
    expect((await client.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } })).result.serverInfo.name).toBe("belfry-plugins");
    const name = qualified("test", "echo");
    expect((await client.request("tools/list")).result.tools.some(tool => tool.name === name)).toBe(true);
    const meta = agent === "opencode" ? { "ai.opencode/sessionID": "native-test" } : agent === "antigravity" ? { conversation_id: "native-test" } : {};
    const reply = await client.request("tools/call", { name, arguments: { text: "Bridge verified" }, _meta: meta });
    expect(reply.result.isError).not.toBe(true); expect(JSON.stringify(reply.result)).toContain("Bridge verified");
    expect(calls).toHaveLength(1); expect(calls[0].context.agentSession).toEqual({ agent, id: "native-test" });
  } finally { await client?.close(); await server.close(); await rm(workspace, { recursive: true, force: true }); }
});

it("keeps a persistent MCP registration inert outside Belfry", async () => {
  const client = bridge({ BELFRY_PLUGIN_MCP_URL: "", BELFRY_PLUGIN_MCP_TOKEN: "" });
  try {
    expect((await client.request("initialize", { protocolVersion: "2024-11-05" })).result.serverInfo.name).toBe("belfry-plugins");
    expect((await client.request("tools/list")).result).toEqual({ tools: [] });
  } finally { await client.close(); }
});
