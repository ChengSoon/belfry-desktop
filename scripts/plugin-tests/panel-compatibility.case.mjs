import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";
import { mcpRequest } from "./mcp-support.mjs";

async function fixture(t) {
  const root = await temporary(t), runtime = await host(t, root, { platform: (message) => message.api === "ui.openPanel" ? message : null });
  const entry = await plugin(root, "pi.todo", { manifest: {
    permissions: ["ui.panel", "agent.tool.register"], ui: { panel: "index.html" },
  }, code: `
    module.exports.onLoad = () => pi.agent.registerTool({ name: "todo_manage", description: "list todos",
      execute: () => pi.plugin.getSettings() });
    module.exports.onPanelInvoke = async (channel, payload) => {
      if (channel !== "todo.sync") throw new Error("unsupported panel channel: " + channel);
      await pi.plugin.setSettings({ todos: payload.todos });
      return { ok: true, enabled: payload.enabled };
    };
  ` });
  await writeFile(join(entry.path, "index.html"), "<!doctype html><title>Todo</title>");
  await runtime.call("load", entry);
  const surface = await runtime.call("panel", { pluginId: entry.manifest.id });
  const url = new URL(surface.url), endpoint = `${url.origin}${url.pathname.split("/").slice(0, 3).join("/")}/__invoke`;
  const invoke = async (api, payload) => {
    const response = await fetch(endpoint, { method: "POST", headers: { Origin: url.origin, "Content-Type": "application/json" },
      body: JSON.stringify({ api, payload }) });
    return response.json();
  };
  const session = await runtime.call("session.open", { workspace: root, sessionId: "todo-panel" });
  return { runtime, entry, session, invoke };
}

test("PI skill.setEnabled forwards the payload id and saves panel todos for the Agent tool", async (t) => {
  const { session, invoke } = await fixture(t);
  const todos = [{ id: "one", text: "mes系统开发", done: false }];
  const result = await invoke("skill.setEnabled", { id: "todo.sync", enabled: true, todos });
  assert.deepEqual(result, { ok: true, value: { ok: true, enabled: true } });
  const tool = (await mcpRequest(session, { method: "tools/list" })).data.result.tools.find((item) => item.description.includes("list todos"));
  const listed = (await mcpRequest(session, { method: "tools/call", params: { name: tool.name } })).data.result;
  assert.deepEqual(JSON.parse(listed.content[0].text).todos, todos);
});

test("direct custom panel channels remain supported and legacy dispatch cannot route to host management", async (t) => {
  const { invoke, runtime, entry } = await fixture(t);
  assert.equal((await invoke("todo.sync", { todos: [] })).ok, true);
  for (const payload of [{}, { id: "" }, { id: 1 }, { id: "management.plugin" }, { id: "author.publish" }]) {
    assert.equal((await invoke("skill.setEnabled", payload)).ok, false);
  }
  assert.deepEqual((await runtime.call("settings.get", { pluginId: entry.manifest.id })).todos, []);
});
