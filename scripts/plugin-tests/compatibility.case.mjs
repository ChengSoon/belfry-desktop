import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { check } from "../../src-tauri/src/plugins/node/author.mjs";
import { host, plugin, temporary } from "./support.mjs";

test("missing optional icons warn without blocking a valid PI plugin", async (t) => {
  const root = await temporary(t), entry = await plugin(root, "demo.hello", { code: "module.exports = {};", manifest: { icon: "icon.png" } });
  const result = await check(entry.path);
  assert.equal(result.ok, true); assert.match(result.warnings.join(" "), /icon/);
});
test("PI manifest check rejects invalid settings, contribution permissions and unsupported engines", async (t) => {
  const root = await temporary(t);
  const invalid = [
    { engines: { piDesktop: ">=99.0.0" } },
    { contributes: { settings: [{ key: "token", type: "string", secret: true }] } },
    { contributes: { settings: [{ key: "bad", type: "code" }] } },
    { contributes: { mcpServers: [{ id: "remote", transport: "http", url: "https://example.invalid" }] } },
    { contributes: { bus: { publish: ["demo.topic"] } } },
  ];
  for (const [i, extra] of invalid.entries()) {
    const entry = await plugin(root, `local.invalid-${i}`, { code: "module.exports = {};", manifest: extra });
    await assert.rejects(check(entry.path), undefined, JSON.stringify(extra));
  }
});
test("custom panel channels invoke the plugin module without exposing host administration", async (t) => {
  const root = await temporary(t), requests = [];
  const entry = await plugin(root, "local.custom", { code: "module.exports = { onPanelInvoke(channel, payload) { return { channel, value: payload.value + 1 }; } };", manifest: {
    permissions: ["ui.panel"], ui: { panel: "renderer/index.html" },
  } });
  await mkdir(join(entry.path, "renderer")); await writeFile(join(entry.path, "renderer/index.html"), "<html><head></head><body>Custom</body></html>");
  const runtime = await host(t, root, { platform: (request) => { requests.push(request); return null; } });
  await runtime.call("load", entry); await runtime.call("panel", { pluginId: entry.manifest.id });
  const url = requests.find((request) => request.api === "ui.openPanel").url;
  const invoke = new URL(url); invoke.pathname = invoke.pathname.slice(0, invoke.pathname.indexOf("renderer/")) + "__invoke";
  const response = await fetch(invoke, { method: "POST", headers: { "Content-Type": "application/json", Origin: invoke.origin }, body: JSON.stringify({ api: "demo.increment", payload: { value: 2 } }) });
  assert.deepEqual((await response.json()).value, { channel: "demo.increment", value: 3 });
  const denied = await fetch(invoke, { method: "POST", headers: { "Content-Type": "application/json", Origin: invoke.origin }, body: JSON.stringify({ api: "plugins.install", payload: {} }) });
  assert.equal((await denied.json()).ok, false);
});
