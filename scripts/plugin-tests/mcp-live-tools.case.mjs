import assert from "node:assert/strict";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";

async function invoke(session, name, args = {}) {
  return (await mcpRequest(session, { method: "tools/call", params: { name, arguments: args } })).data.result;
}

async function todoPlugin(root) {
  return plugin(root, "pi.todo", { manifest: { name: "小清新待办", permissions: ["agent.tool.register"] }, code: `
    module.exports.onLoad = () => pi.agent.registerTool({
      name: "todo_manage", description: "管理待办",
      schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: async (args) => {
        const settings = await pi.plugin.getSettings();
        await pi.plugin.setSettings({ todos: [...(settings.todos ?? []), args.text] });
        return pi.plugin.getSettings();
      }
    });
  ` });
}

test("an existing Agent can discover and call a newly installed plugin with its original tool catalog", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "before-install" });
  const original = (await mcpRequest(session, { method: "tools/list" })).data.result.tools;
  assert.ok(original.some((tool) => tool.name === "PluginTools"));
  assert.ok(original.some((tool) => tool.name === "PluginCall"));
  const entry = await todoPlugin(root);
  await runtime.call("load", entry);
  const catalog = JSON.parse((await invoke(session, "PluginTools", { query: "小清新" })).content[0].text);
  assert.equal(catalog.tools.length, 1);
  const tool = catalog.tools[0];
  assert.equal(tool.pluginId, "pi.todo"); assert.equal(tool.name, "todo_manage");
  assert.deepEqual(tool.inputSchema.required, ["text"]);
  assert.ok(!original.some((item) => item.name === tool.mcpName));
  const added = await invoke(session, "PluginCall", { pluginId: tool.pluginId, name: tool.name, arguments: { text: "mes系统开发" } });
  assert.equal(added.isError, undefined);
  assert.deepEqual(JSON.parse(added.content[0].text).todos, ["mes系统开发"]);
  await runtime.call("unload", { pluginId: entry.manifest.id });
  const removed = JSON.parse((await invoke(session, "PluginTools")).content[0].text);
  assert.deepEqual(removed.tools, []);
  const denied = await invoke(session, "PluginCall", { pluginId: tool.pluginId, name: tool.name, arguments: { text: "已撤销" } });
  assert.equal(denied.isError, true);
});

test("live plugin discovery and invocation enforce the calling Agent workspace after scope changes", async (t) => {
  const root = await realpath(await temporary(t)), first = join(root, "first"), second = join(root, "second");
  await mkdir(first); await mkdir(second);
  const runtime = await host(t, root), entry = await todoPlugin(root);
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: first, sessionId: "scoped" });
  await runtime.call("management.plugin", { id: entry.manifest.id, patch: { scope: { mode: "projects", projects: [second] } } });
  await runtime.call("context", { workspace: second });
  assert.deepEqual(JSON.parse((await invoke(session, "PluginTools")).content[0].text).tools, []);
  const args = { pluginId: entry.manifest.id, name: "todo_manage", arguments: { text: "越界任务" } };
  assert.equal((await invoke(session, "PluginCall", args)).isError, true);
  await runtime.call("management.plugin", { id: entry.manifest.id, patch: { scope: { mode: "projects", projects: [first] } } });
  assert.equal(JSON.parse((await invoke(session, "PluginTools", { query: "TODO_MANAGE" })).content[0].text).tools.length, 1);
  assert.equal((await invoke(session, "PluginCall", args)).isError, undefined);
});

test("live plugin calls preserve MCP content and reject invalid routing arguments", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const entry = await plugin(root, "mine.content", { manifest: { permissions: ["agent.tool.register"] }, code: `
    module.exports.onLoad = () => pi.agent.registerTool({ name: "note", description: "note",
      execute: () => ({ content: [{ type: "text", text: "原始内容" }], isError: true }) });
  ` });
  await runtime.call("load", entry);
  const session = await runtime.call("session.open", { workspace: root, sessionId: "content" });
  const result = await invoke(session, "PluginCall", { pluginId: entry.manifest.id, name: "note" });
  assert.deepEqual(result, { content: [{ type: "text", text: "原始内容" }], isError: true });
  for (const args of [{}, { pluginId: entry.manifest.id, name: "note", arguments: [] }]) {
    assert.equal((await invoke(session, "PluginCall", args)).isError, true);
  }
  assert.equal((await invoke(session, "PluginTools", { query: [] })).isError, true);
});
