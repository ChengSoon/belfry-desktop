import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { host, plugin, temporary } from "./support.mjs";

test("oversized worker values and file contents report a bounded error without killing the host", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  await writeFile(join(root, "escaped.txt"), '"'.repeat(700 * 1024));
  const entry = await plugin(root, "mine.large", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "large", description: "large", execute: args => args.file ? pi.fs.readText("escaped.txt") : "x".repeat(args.size)
  });`, manifest: { permissions: ["agent.tool.register", "fs.read"], fs: { read: { scope: ["*.txt"] } } } });
  await runtime.call("context", { workspace: root }); await runtime.call("load", entry);
  const call = (args) => runtime.call("tool", { pluginId: entry.manifest.id, name: "large", args });
  await assert.rejects(call({ size: 1024 * 1024 }), { code: "LIMIT_EXCEEDED" });
  await assert.rejects(call({ file: true }), { code: "LIMIT_EXCEEDED" });
  assert.equal(await call({ size: 2 }), "xx");
  assert.ok((await runtime.call("hello")).pid);
});

test("public PI byte ranges support 8 MiB while each worker message remains bounded", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const size = 5 * 1024 * 1024;
  await writeFile(join(root, "range.bin"), Buffer.alloc(size, 91));
  const entry = await plugin(root, "mine.range", { code: `module.exports.onLoad = () => pi.agent.registerTool({
    name: "range", description: "range", execute: async () => {
      const value = await pi.fs.readRange("range.bin", 0, 8 * 1024 * 1024);
      return { size: value.bytes.length, total: value.totalSize, first: value.bytes[0], last: value.bytes.at(-1) };
    }
  });`, manifest: { permissions: ["agent.tool.register", "fs.read"], fs: { read: { scope: ["*.bin"] } } } });
  await runtime.call("context", { workspace: root }); await runtime.call("load", entry);
  assert.deepEqual(await runtime.call("tool", { pluginId: entry.manifest.id, name: "range" }), { size, total: size, first: 91, last: 91 });
});

test("large theme catalogs transfer metadata separately and reject stale theme contents", async (t) => {
  const root = await temporary(t), runtime = await host(t, root);
  const themes = Array.from({ length: 6 }, (_, index) => ({ id: `theme-${index}`, label: `Theme ${index}`, path: `theme-${index}.css` }));
  const entry = await plugin(root, "mine.themes", { code: "module.exports = {};", manifest: {
    permissions: ["ui.theme"], contributes: { themes },
  } });
  const css = `:root { --name: '${"主题".repeat(35 * 1024)}'; }`;
  for (const theme of themes) await writeFile(join(entry.path, theme.path), css);
  await runtime.call("load", entry);
  const catalog = await runtime.call("catalog", { themeContents: false });
  assert.equal(catalog.themes.length, themes.length);
  assert.ok(catalog.themes.every((theme) => theme.css === undefined && /^[a-f0-9]{64}$/.test(theme.cssDigest)));
  for (const theme of catalog.themes) assert.equal(await runtime.call("theme", theme), css);
  await writeFile(join(entry.path, themes[0].path), ":root { --color: red; }");
  await runtime.call("load", entry);
  await assert.rejects(runtime.call("theme", catalog.themes[0]), { code: "PLUGIN_CHANGED" });
  await runtime.call("unload", { pluginId: entry.manifest.id });
  await assert.rejects(runtime.call("theme", catalog.themes[1]), { code: "NOT_FOUND" });
});
