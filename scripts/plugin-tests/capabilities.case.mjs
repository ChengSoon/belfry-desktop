import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

test("declared file scopes allow intended writes and reject protected or escaping paths", async (t) => {
  const root = await temporary(t);
  const entry = await plugin(root, "local.files", { code: `module.exports.onLoad = async () =>
    pi.agent.registerTool({ name: "write", description: "Write", execute: async (args) => {
      await pi.fs.writeText(args.path, args.text); return pi.fs.readText(args.path);
    }});`, manifest: { permissions: ["agent.tool.register", "fs.read", "fs.write"],
    fs: { read: { scope: ["**/*"] }, write: { scope: ["out/**"] } },
    contributes: { agentTools: [{ name: "write", description: "Write" }] } } });
  const runtime = await host(t, root);
  await runtime.call("context", { workspace: root });
  await runtime.call("load", entry);
  const call = (path) => runtime.call("tool", { pluginId: entry.manifest.id, name: "write", args: { path, text: "hello" } });
  assert.equal(await call("out/note.txt"), "hello");
  assert.equal(await readFile(join(root, "out/note.txt"), "utf8"), "hello");
  for (const path of ["keep.txt", "../escape.txt", "out/.env", "/tmp/outside.txt"]) await assert.rejects(call(path));
});

test("declared skills are available to the agent with their contents", async (t) => {
  const root = await temporary(t);
  const entry = await plugin(root, "local.skill", { code: "module.exports.onLoad = () => {};", manifest: {
    permissions: ["agent.prompt.inject"], contributes: { skills: ["guide.md"] },
  } });
  await writeFile(join(entry.path, "guide.md"), "---\nname: check-diff\ndescription: 检查改动\n---\n\nRead the diff first.");
  const runtime = await host(t, root);
  await runtime.call("load", entry);
  const catalog = await runtime.call("catalog");
  assert.equal(catalog.skills[0].name, "check-diff");
  const result = await runtime.call("skill", { pluginId: entry.manifest.id, path: "guide.md" });
  assert.match(result, /Read the diff first/);
});

test("resident services start and stop, and bus messages reach other subscribed plugins", async (t) => {
  const root = await temporary(t);
  const listener = await plugin(root, "local.listener", { code: `let unsubscribe;
    module.exports.onLoad = async () => {
      unsubscribe = await pi.bus.subscribe("demo.**", async message => pi.plugin.setSettings({ received: message.payload.text }));
      pi.services.register({ id: "listener", start: () => pi.plugin.setSettings({ running: true }),
        stop: () => pi.plugin.setSettings({ running: false }) });
    }; module.exports.onUnload = async () => unsubscribe?.();`, manifest: {
    permissions: ["background.service", "bus.subscribe"], contributes: {
      services: [{ id: "listener" }], bus: { subscribe: ["demo.**"] },
      settings: [{ key: "received", type: "string", default: "" }, { key: "running", type: "boolean", default: false }],
    },
  } });
  const publisher = await plugin(root, "local.publisher", { code: `module.exports.onLoad = async () =>
    pi.commands.register({ id: "send", title: "Send", run: () => pi.bus.publish("demo.hello", { text: "delivered" }) });`, manifest: {
    permissions: ["bus.publish"], contributes: { commands: [{ id: "send", title: "Send" }], bus: { publish: ["demo.hello"] } },
  } });
  const runtime = await host(t, root);
  await runtime.call("load", listener); await runtime.call("load", publisher);
  assert.equal((await runtime.call("settings.get", { pluginId: listener.manifest.id })).running, true);
  await runtime.call("command", { pluginId: publisher.manifest.id, commandId: "send" });
  let settings;
  for (let attempt = 0; attempt < 20; attempt++) {
    settings = await runtime.call("settings.get", { pluginId: listener.manifest.id });
    if (settings.received) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(settings.received, "delivered");
  assert.equal((await runtime.call("catalog")).services[0].status, "running");
});

test("panel assets and bridge require a plugin-specific token and revoke on unload", async (t) => {
  const root = await temporary(t);
  const requests = [];
  const entry = await plugin(root, "local.panel", { code: `module.exports.onLoad = async () =>
    pi.commands.register({ id: "open", title: "Open", run: () => pi.ui.openPanel() });`, manifest: {
    permissions: ["ui.panel"], ui: { panel: "renderer/index.html" },
    contributes: { commands: [{ id: "open", title: "Open" }], settings: [{ key: "greeting", type: "string", default: "hello" }] },
  } });
  await mkdir(join(entry.path, "renderer"));
  await writeFile(join(entry.path, "renderer/index.html"), "<!doctype html><html><head></head><body>Panel</body></html>");
  const runtime = await host(t, root, { platform: (request) => { requests.push(request); return null; } });
  await runtime.call("load", entry);
  await runtime.call("command", { pluginId: entry.manifest.id, commandId: "open" });
  const url = requests.find((request) => request.api === "ui.openPanel")?.url;
  assert.ok(url, "打开面板需要真实资源 URL");
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /__bridge\.js/);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  const base = url.slice(0, url.indexOf("renderer/index.html"));
  const settings = await fetch(`${base}__invoke`, { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(url).origin },
    body: JSON.stringify({ api: "plugin.getSettings" }) });
  assert.deepEqual((await settings.json()).value, { greeting: "hello" });
  const denied = await fetch(url.replace(/\/p\/[^/]+\//, "/p/invalid/"));
  assert.equal(denied.status, 404);
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await assert.rejects(fetch(url));
});
