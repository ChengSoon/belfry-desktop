import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { check } from "../../src-tauri/src/plugins/node/author.mjs";
import { plugin, temporary } from "./support.mjs";

test("PI market metadata, current engines and browser.cdp survive author validation", async (t) => {
  const root = await temporary(t);
  const extra = {
    engines: { piDesktop: ">=0.14.3" }, permissions: ["browser.cdp"],
    categories: ["developer-tools"], changelog: ["Initial release"],
    safetyNotes: "Runs in the plugin host", i18n: { "zh-CN": { name: "日志查看器" } },
  };
  const entry = await plugin(root, "local.upstream", { code: "module.exports = {};", manifest: extra });
  const result = await check(entry.path);
  assert.equal(result.ok, true);
});

test("PI renderer bundles larger than the old 2 MiB file limit are accepted", async (t) => {
  const root = await temporary(t), entry = await plugin(root, "local.large-bundle", { code: "module.exports = {};" });
  await writeFile(join(entry.path, "renderer.js"), Buffer.alloc(3 * 1024 * 1024, " "));
  assert.equal((await check(entry.path)).ok, true);
});
