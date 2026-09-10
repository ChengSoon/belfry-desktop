import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

async function request(session, method, params = {}) {
  const response = await fetch(session.url, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await response.json());
}
async function fixture(t) {
  const root = await temporary(t);
  const entry = await plugin(root, "mine.resources", { code: "module.exports = {};", manifest: {
    permissions: ["mcp.server.local"], contributes: { mcpServers: [{ id: "docs", command: "node", transport: "stdio", args: ["server.cjs"] }] },
  } });
  await writeFile(join(entry.path, "server.cjs"), `require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
    const msg = JSON.parse(line); if (msg.id === undefined) return;
    const replies = {
      initialize: { protocolVersion: "2024-11-05", capabilities: { prompts: {}, resources: {} } },
      "prompts/list": { prompts: [{ name: "summarize", description: "Summarize a note", arguments: [{ name: "note", required: true }] }] },
      "prompts/get": { messages: [{ role: "user", content: { type: "text", text: "Summary: " + (msg.params.arguments?.note ?? "") } }] },
      "resources/list": msg.params.cursor ? { resources: [{ uri: "notes://two", name: "Second" }] } : { resources: [{ uri: "notes://one", name: "First", mimeType: "text/plain" }], nextCursor: "page2" },
      "resources/templates/list": { resourceTemplates: [{ uriTemplate: "notes://{id}", name: "Notes" }] },
      "resources/read": { contents: [{ uri: msg.params.uri, text: "body of " + msg.params.uri }] },
    };
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: replies[msg.method] }) + "\\n");
  });`);
  const runtime = await host(t, root);
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "reader" });
  return { root, entry, runtime, session };
}
test("plugin MCP prompts, paginated resources and templates are usable through the agent connection", async (t) => {
  const { session } = await fixture(t);
  const prompts = (await request(session, "prompts/list")).result.prompts;
  assert.equal(prompts.length, 1);
  const prompt = await request(session, "prompts/get", { name: prompts[0].name, arguments: { note: "my note" } });
  assert.equal(prompt.result.messages[0].content.text, "Summary: my note");
  const resources = (await request(session, "resources/list")).result.resources;
  assert.equal(resources.length, 2);
  assert.notEqual(resources[0].uri, "notes://one");
  const read = (await request(session, "resources/read", { uri: resources[0].uri })).result;
  assert.deepEqual(read.contents[0], { uri: resources[0].uri, text: "body of notes://one" });
  const template = (await request(session, "resources/templates/list")).result.resourceTemplates[0];
  const dynamic = (await request(session, "resources/read", { uri: template.uriTemplate.replace("{id}", "three") })).result;
  assert.equal(dynamic.contents[0].text, "body of notes://three");
});
test("MCP resources disappear outside plugin scope and after unloading", async (t) => {
  const { root, entry, runtime, session } = await fixture(t);
  const resource = (await request(session, "resources/list")).result.resources[0];
  assert.ok(resource);
  const other = join(root, "other"); await mkdir(other);
  await runtime.call("management.plugin", { id: entry.manifest.id, patch: { scope: { mode: "projects", projects: [other] } } });
  assert.deepEqual((await request(session, "resources/list")).result.resources, []);
  assert.ok((await request(session, "resources/read", { uri: resource.uri })).error);
  await runtime.call("unload", { pluginId: entry.manifest.id });
  assert.deepEqual((await request(session, "prompts/list")).result.prompts, []);
});
