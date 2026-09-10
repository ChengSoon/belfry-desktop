import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { host, plugin, temporary } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";
import { McpContributions } from "../../src-tauri/src/plugins/node/mcp-contributions.mjs";

async function fixture(t) {
  const root = await temporary(t), streams = new Set(); let revision = 1, toolClosed, ready;
  const started = new Promise((resolve) => { ready = resolve; });
  const cancelled = new Promise((resolve) => { toolClosed = resolve; });
  const server = createServer(async (request, response) => {
    if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
    if (request.method === "GET") {
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
      streams.add(response); response.on("close", () => streams.delete(response)); return;
    }
    let source = ""; for await (const chunk of request) source += chunk;
    const message = JSON.parse(source);
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    if (message.method === "tools/call" && message.params.arguments?.wait) {
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": waiting\n\n");
      response.on("close", toolClosed); ready(); return;
    }
    const result = message.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: true } } }
      : message.method === "tools/list" ? { tools: [{ name: `tool${revision}`, inputSchema: { type: "object" } }] }
      : { content: [{ type: "resource_link", name: "Note", uri: "notes://one" }, { type: "resource", resource: { uri: "notes://one", text: "Note body" } }] };
    response.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "fixture-session" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const entry = await plugin(root, "mine.updates", { code: "module.exports = {};", manifest: { permissions: ["mcp.server.remote"],
    net: { domains: ["127.0.0.1"] }, contributes: { mcpServers: [{ id: "docs", transport: "http", url: `http://127.0.0.1:${server.address().port}/mcp` }] } } });
  const runtime = await host(t, root); await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "updates" });
  return { runtime, session, started, cancelled, streams, change: () => {
    revision++; for (const stream of streams) stream.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })}\r\n\r\n`);
  } };
}

test("remote MCP notifications refresh tools with optional descriptions and isolate resource links", async (t) => {
  const { runtime, session, streams, change } = await fixture(t);
  for (let attempt = 0; !streams.size && attempt < 40; attempt++) await delay(25);
  assert.equal(streams.size, 1, "remote notification stream should be connected");
  change();
  let catalog;
  for (let attempt = 0; attempt < 40; attempt++) {
    catalog = await runtime.call("catalog");
    if (catalog.tools.some((tool) => tool.name === "mcp.docs.tool2")) break;
    await delay(25);
  }
  assert.deepEqual(catalog.tools.map((tool) => tool.name), ["mcp.docs.tool2"]);
  const tool = (await mcpRequest(session, { method: "tools/list" })).data.result.tools.find((tool) => tool.description.includes("tool2"));
  const result = (await mcpRequest(session, { method: "tools/call", params: { name: tool.name } })).data.result;
  assert.equal(result.content[0].uri, "pi-plugin-mcp://mine.updates/docs/notes://one");
  assert.equal(result.content[1].resource.uri, result.content[0].uri);
});

test("revoking an Agent session cancels an in-flight remote MCP response", async (t) => {
  const { runtime, session, started, cancelled } = await fixture(t);
  const tool = (await mcpRequest(session, { method: "tools/list" })).data.result.tools.find((tool) => tool.description.includes("tool1"));
  const pending = mcpRequest(session, { method: "tools/call", params: { name: tool.name, arguments: { wait: true } } });
  await started; await runtime.call("session.revoke", { sessionId: "updates" });
  assert.equal((await pending).data.result.isError, true);
  await cancelled;
});

test("MCP refreshes retain notifications received during a refresh and ignore replaced peers", async () => {
  const entry = { manifest: { id: "mine.refresh", name: "Refresh" } }, events = [], broker = { tools: new Map(), event: (name) => events.push(name) };
  const contributions = new McpContributions(broker), key = "mine.refresh:docs";
  let release, count = 0;
  const held = new Promise((resolve) => { release = resolve; });
  const peer = { entry, descriptor: { id: "docs" }, active: true, catalog: { tools: [] }, refreshCatalog: async () => {
    count++; if (count === 1) await held;
    peer.catalog = { tools: [{ name: `tool${count}`, description: "Changed" }] };
  } };
  contributions.peers.set(key, peer);
  const pending = contributions.refresh(entry, key, peer);
  await contributions.refresh(entry, key, peer); release(); await pending;
  assert.equal(count, 2); assert.equal([...broker.tools.values()][0].name, "mcp.docs.tool2");
  const replacement = { ...peer, catalog: { tools: [] } }; contributions.peers.set(key, replacement);
  const before = events.length;
  contributions.withdraw(entry.manifest.id, key, peer);
  await contributions.refresh(entry, key, peer);
  assert.equal(replacement.active, true); assert.equal(events.length, before);
});
