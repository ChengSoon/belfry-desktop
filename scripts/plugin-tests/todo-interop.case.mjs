import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { mcpRequest } from "./mcp-support.mjs";
import { capturePage, originalPlugin, pageReady, upstreamPath } from "./upstream-support.mjs";

const SYNC_ATTEMPTS = 40;
const SYNC_INTERVAL_MS = 25;
async function callTodo(session, args) {
  const result = (await mcpRequest(session, { method: "tools/call", params: {
    name: "PluginCall", arguments: { pluginId: "pi.todo", name: "todo_manage", arguments: args },
  } })).data.result;
  assert.equal(result.isError, undefined, JSON.stringify(result));
  const value = JSON.parse(result.content[0].text);
  assert.equal(value.ok, true, JSON.stringify(value)); return value;
}
async function synchronized(session) {
  let result;
  for (let attempt = 0; attempt < SYNC_ATTEMPTS; attempt++) {
    result = await callTodo(session, { action: "list" });
    if (result.todos.some((todo) => todo.text === "mes系统开发")) return result;
    await delay(SYNC_INTERVAL_MS);
  }
  assert.fail(`原版面板数据未同步到工具：${JSON.stringify(result)}`);
}

test("unmodified PI Todo shares panel changes with the Agent and persists tool changes across reloads", async (t) => {
  const path = process.env.BELFRY_PI_TODO_SOURCE ?? upstreamPath(t, "pi.todo"); if (!path) return;
  const { workspace, runtime, view, entry } = await originalPlugin(t, { path });
  assert.equal(await pageReady(view, "!!document.querySelector('#newTodo')"), true);
  const session = await runtime.call("session.open", { workspace, sessionId: "original-todo" });
  const discovery = (await mcpRequest(session, { method: "tools/call", params: { name: "PluginTools", arguments: { query: "pi.todo" } } })).data.result;
  assert.equal(JSON.parse(discovery.content[0].text).tools[0].name, "todo_manage");
  await view.cdp.evaluate("document.querySelector('#newTodo').focus()");
  await view.send("Input.insertText", { text: "mes系统开发" });
  for (const type of ["keyDown", "keyUp"]) {
    await view.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  }
  assert.equal((await synchronized(session)).total, 1);
  assert.equal((await callTodo(session, { action: "add", text: "接口联调" })).total, 2);
  // 原版 0.6.5 在面板启动和重新聚焦时读取共享数据。
  await view.cdp.evaluate("window.dispatchEvent(new Event('focus'))");
  assert.equal(await pageReady(view, "document.body.innerText.includes('接口联调') && document.body.innerText.includes('mes系统开发')"), true);
  await view.cdp.evaluate("Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {})))");
  await capturePage(view, "original-todo-sync");
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await runtime.call("load", entry);
  const restored = await callTodo(session, { action: "list" });
  assert.deepEqual(restored.todos.map((todo) => todo.text).sort(), ["mes系统开发", "接口联调"].sort());
});
