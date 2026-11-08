import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { dataPath, getSettings, setSettings } from "../../src-tauri/src/plugins/node/settings.mjs";
import { temporary } from "./support.mjs";

const MAX_BYTES = 1024 * 1024;
const manifest = { id: "local.settings-limit", contributes: {} };

test("cumulative settings stop at the final UTF-8 file budget and preserve the previous file", async (t) => {
  const root = await temporary(t);
  const file = join(await dataPath(root, manifest.id), "settings.json");
  for (let index = 0; index < 17; index++) await setSettings(root, manifest, { [`key${index}`]: "a".repeat(60000) });
  const before = await readFile(file);
  assert.ok(before.length < MAX_BYTES);
  await assert.rejects(setSettings(root, manifest, { overflow: "中".repeat(20000) }), { code: "LIMIT_EXCEEDED" });
  assert.deepEqual(await readFile(file), before);
  assert.equal(Object.keys(await getSettings(root, manifest)).length, 17);
  assert.deepEqual(await readdir(await dataPath(root, manifest.id)), ["settings.json"]);
});

test("pretty printing and manifest defaults count toward the final file size", async (t) => {
  const root = await temporary(t);
  const defaults = { ...manifest, contributes: { settings: [{ key: "largeDefault", default: "中".repeat(349518) }] } };
  await assert.rejects(setSettings(root, defaults, {}), { code: "LIMIT_EXCEEDED" });
  assert.deepEqual(await readdir(await dataPath(root, manifest.id)), []);
});

test("parallel merges enforce the same limit without losing accepted keys", async (t) => {
  const root = await temporary(t);
  const results = await Promise.allSettled(Array.from({ length: 20 }, (_, index) => setSettings(root, manifest, { [`k${index}`]: "中".repeat(20000) })));
  const accepted = results.filter((result) => result.status === "fulfilled").length;
  assert.equal(accepted, 17);
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.code === "LIMIT_EXCEEDED"));
  const values = await getSettings(root, manifest);
  assert.equal(Object.keys(values).length, accepted);
  assert.equal(values.k16.length, 20000);
  assert.equal(values.k17, undefined);
});

test("oversized legacy settings retain the original bytes and include a repair path", async (t) => {
  const root = await temporary(t);
  const file = join(await dataPath(root, manifest.id), "settings.json");
  const bytes = JSON.stringify({ legacy: "x".repeat(MAX_BYTES) });
  await writeFile(file, bytes);
  await assert.rejects(getSettings(root, manifest), (error) => error.code === "LIMIT_EXCEEDED" && error.message.includes(file));
  await assert.rejects(setSettings(root, manifest, { legacy: "replaced" }), { code: "LIMIT_EXCEEDED" });
  assert.equal(await readFile(file, "utf8"), bytes);
});
