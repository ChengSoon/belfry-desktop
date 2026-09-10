import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";
import { stdioAdapter } from "./mcp-stdio-support.mjs";

const CHANGED = "notifications/tools/list_changed";
async function initialize(adapter) {
  await adapter.request("initialize", { protocolVersion: "2025-03-26" });
  const ready = adapter.notification(CHANGED);
  adapter.notify("notifications/initialized");
  await ready;
}

test("stdio subscribes with a catalog catch-up and forwards plugin installation and removal", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "live-catalog" });
  const adapter = stdioAdapter(t, session);
  await initialize(adapter);
  const entry = await plugin(root, "mine.new", { manifest: { permissions: ["agent.tool.register"] }, code: `
    module.exports.onLoad = () => pi.agent.registerTool({ name: "new_task", description: "new task", execute: () => "ready" });
  ` });
  const installed = adapter.notification(CHANGED);
  await runtime.call("load", entry); await installed;
  assert.ok((await adapter.request("tools/list")).result.tools.some((tool) => tool.description.includes("new task")));
  const removed = adapter.notification(CHANGED);
  await runtime.call("unload", { pluginId: entry.manifest.id }); await removed;
  assert.ok(!(await adapter.request("tools/list")).result.tools.some((tool) => tool.description.includes("new task")));
});

async function interruptedServer(t) {
  const streams = new Set(); let subscriptions = 0, revision = 1;
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      subscriptions++;
      if (subscriptions === 1) { response.writeHead(503); response.end(); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream" }); response.write(": ready\n\n");
      streams.add(response); response.on("close", () => streams.delete(response)); return;
    }
    let body = ""; for await (const chunk of request) body += chunk;
    const message = JSON.parse(body);
    if (message.id === undefined) { response.writeHead(202); response.end(); return; }
    const result = message.method === "initialize" ? { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: true } } }
      : { tools: [{ name: `new_task_${revision}`, inputSchema: { type: "object" } }] };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { session: { url: `http://127.0.0.1:${server.address().port}/mcp`, token: "fixture-session" },
    subscriptions: () => subscriptions,
    disconnect: () => { revision++; for (const stream of streams) stream.end(); },
  };
}

test("stdio recovers failed subscriptions and refreshes changes missed during a disconnected event stream", async (t) => {
  const server = await interruptedServer(t), adapter = stdioAdapter(t, server.session);
  await initialize(adapter);
  assert.equal(server.subscriptions(), 2);
  assert.equal((await adapter.request("tools/list")).result.tools[0].name, "new_task_1");
  const reconnected = adapter.notification(CHANGED);
  server.disconnect(); await reconnected;
  assert.equal(server.subscriptions(), 3);
  assert.equal((await adapter.request("tools/list")).result.tools[0].name, "new_task_2");
});
