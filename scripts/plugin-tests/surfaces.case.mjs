import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { reviveApiValue } from "../../src-tauri/src/plugins/node/api-values.mjs";
import { host, plugin, temporary } from "./support.mjs";
import { recordDropped } from "../../src-tauri/src/plugins/node/file-grants.mjs";
import { filesystem } from "../../src-tauri/src/plugins/node/filesystem.mjs";

async function fixture(t, extra = {}) {
  const root = await temporary(t);
  const entry = await plugin(root, "local.surface", { code: `module.exports = { onPanelInvoke(channel, payload) {
    if (channel === 'test.read') return pi.fs.readRange(payload.path, 0, 8, payload.grantId).then(r => ({ typed: r.bytes instanceof Uint8Array, text: new TextDecoder().decode(r.bytes) }));
    return { channel, payload };
  } };`, manifest: { permissions: ["ui.view", "fs.read"], fs: { read: { root: "userSelected" } },
    contributes: { views: [{ id: "logs", title: "Logs", entry: "index.html" }] }, ...extra } });
  await writeFile(join(entry.path, "index.html"), "<html><head></head><body>Logs</body></html>");
  const selected = join(root, "selected"); await mkdir(selected); await writeFile(join(selected, "sample.log"), "log line");
  const runtime = await host(t, root, { platform: ({ api }) => api === "fs.requestDirectory" ? { path: selected, name: "selected" } : null });
  await runtime.call("load", entry);
  const surface = await runtime.call("surface", { pluginId: entry.manifest.id, viewId: "logs" });
  const endpoint = new URL("__invoke", surface.url);
  const invoke = async (api, payload) => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Origin: endpoint.origin }, body: JSON.stringify({ api, payload }) });
    const result = await response.json();
    if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.value;
  };
  return { root, entry, selected, runtime, surface, invoke };
}

test("embedded views keep host isolation and forward plugin-defined panel channels", async (t) => {
  const { surface, invoke } = await fixture(t);
  const response = await fetch(surface.url);
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors tauri:\/\/localhost/);
  assert.deepEqual(await invoke("app.customFeature", { value: 1 }), { channel: "app.customFeature", payload: { value: 1 } });
  await assert.rejects(invoke("plugins.install", {}));
});

test("user-selected roots work without a glob and native drop grants stay file-specific", async (t) => {
  const { entry, selected, runtime, invoke } = await fixture(t);
  await assert.rejects(invoke("fs.stat", { path: "sample.log" }));
  await invoke("fs.requestDirectory", {});
  assert.equal((await invoke("fs.stat", { path: "sample.log" })).size, 8);
  assert.deepEqual(await invoke("test.read", { path: "sample.log" }), { typed: true, text: "log line" });
  const path = join(selected, "sample.log");
  await assert.rejects(invoke("fs.registerDropped", { path }), { code: "PERMISSION_DENIED" });
  await runtime.call("surface.drop", { pluginId: entry.manifest.id, paths: [path] });
  const { grantId } = await invoke("fs.registerDropped", { path });
  assert.equal((await invoke("fs.stat", { path, grantId })).size, 8);
  await assert.rejects(invoke("fs.stat", { path: join(selected, "other.log"), grantId }), { code: "PERMISSION_DENIED" });
  await assert.rejects(invoke("fs.registerDropped", { path }), { code: "PERMISSION_DENIED" });
});

test("a maximum-sized binary range crosses the host transport without expansion", async (t) => {
  const { selected, invoke } = await fixture(t);
  const bytes = Buffer.alloc(512 * 1024, 255);
  await writeFile(join(selected, "binary.log"), bytes);
  await invoke("fs.requestDirectory", {});
  const result = await invoke("fs.readRange", { path: "binary.log", byteOffset: 0, length: bytes.length });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 1024 * 1024, "宿主消息必须装得下一个合法读取范围");
  assert.deepEqual(Buffer.from(reviveApiValue("fs.readRange", result).bytes), bytes);
});

test("selected file contents use an isolated token and detect replacement before reading", async (t) => {
  const root = await temporary(t), path = join(root, "selected.txt");
  await writeFile(path, "真实文件内容");
  const entry = { manifest: { permissions: ["fs.read"] } };
  const [file] = await recordDropped(entry, [path]);
  const request = { entry, api: "fs.readSelection", args: [file.selectionId, 0, 512], context: {} };
  const result = reviveApiValue(request.api, await filesystem(request));
  assert.equal(new TextDecoder().decode(result.bytes), "真实文件内容");
  await assert.rejects(filesystem({ ...request, entry: { manifest: entry.manifest } }), { code: "PERMISSION_DENIED" });
  await writeFile(path, "更改后的文件");
  await assert.rejects(filesystem(request), { code: "FILE_CHANGED" });
});
