import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, symlink, readdir, utimes } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { win32 } from "node:path";
import test from "node:test";
import { temporary } from "./support.mjs";
import { scaffold } from "../../src-tauri/src/plugins/node/author.mjs";
import { PersonalMarket, PERSONAL_SOURCE } from "../../src-tauri/src/plugins/node/personal-market.mjs";
import { PluginManagement } from "../../src-tauri/src/plugins/node/management.mjs";
import { PluginMarket } from "../../src-tauri/src/plugins/node/market.mjs";
import { inside } from "../../src-tauri/src/plugins/node/market-storage.mjs";

async function fixture(t) {
  const base = await temporary(t), directory = join(base, "my-plugin");
  await scaffold({ directory, template: "panel-basic", id: "mine.notes", name: "我的笔记", author: "Maker" });
  const market = new PersonalMarket(join(base, "market", "personal"));
  return { base, directory, market };
}

test("a creator can publish, install and export an independent market without an account", async (t) => {
  const { base, directory, market } = await fixture(t);
  const publication = await market.publish({ directory, changelog: "首次发布" });
  const catalog = await market.catalog();
  assert.equal(catalog.plugins[0].author, "Maker");
  assert.equal(catalog.plugins[0].versions[0].changelog, "首次发布");
  const management = await new PluginManagement(base).init();
  const client = new PluginMarket({ base, management, installed: () => [] });
  assert.equal(client.source(), PERSONAL_SOURCE);
  assert.equal((await client.search()).plugins[0].id, "mine.notes");
  const prepared = await client.prepare({ id: "mine.notes" });
  assert.equal(createHash("sha256").update(await readFile(prepared.path)).digest("hex"), publication.sha256);
  const destination = join(base, "public-site");
  await market.export(destination);
  const exported = JSON.parse(await readFile(join(destination, "catalog.json"), "utf8"));
  assert.match(exported.plugins[0].versions[0].url, /^packages\//);
  assert.equal(createHash("sha256").update(await readFile(join(destination, exported.plugins[0].versions[0].url))).digest("hex"), publication.sha256);
  assert.match(await readFile(join(destination, "index.html"), "utf8"), /catalog\.json/);
  const page = await readFile(join(destination, "index.html"), "utf8");
  assert.doesNotThrow(() => new Function(page.match(/<script>([\s\S]*?)<\/script>/)[1]));
  assert.ok(!JSON.stringify(exported).includes(base));
  const server = createServer(async (request, response) => {
    try { response.end(await readFile(join(destination, new URL(request.url, "http://localhost").pathname))); }
    catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await management.setSource({ pluginMarketSource: "custom", pluginMarketCustomUrl: `http://127.0.0.1:${server.address().port}/catalog.json` });
  const online = await client.prepare({ id: "mine.notes" });
  assert.deepEqual(await readFile(online.path), await readFile(prepared.path));
});

test("published versions are immutable, source updates add a new version", async (t) => {
  const { directory, market } = await fixture(t);
  const first = await market.publish({ directory });
  assert.equal((await market.publish({ directory })).sha256, first.sha256);
  await writeFile(join(directory, "new.txt"), "change");
  await assert.rejects(market.publish({ directory }), { code: "VERSION_EXISTS" });
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  manifest.version = "0.2.0";
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest));
  await market.publish({ directory });
  assert.deepEqual((await market.catalog()).plugins[0].versions.map((item) => item.version), ["0.2.0", "0.1.0"]);
});

test("publishing refuses files changed after the user's preview", async (t) => {
  const { directory, market } = await fixture(t);
  const { check } = await import("../../src-tauri/src/plugins/node/author.mjs");
  const inspected = await check(directory);
  await writeFile(join(directory, "changed.txt"), "new content");
  await assert.rejects(market.publish({ directory, expectedDigest: inspected.digest }), { code: "PLUGIN_CHANGED" });
  assert.deepEqual((await market.catalog()).plugins, []);
});

test("exports do not overwrite existing files and local artifacts reject links and traversal", async (t) => {
  const { base, directory, market } = await fixture(t);
  await market.publish({ directory });
  const output = join(base, "keep"); await mkdir(output); await writeFile(join(output, "keep.txt"), "keep");
  await assert.rejects(market.export(output), /空目录/);
  assert.equal(await readFile(join(output, "keep.txt"), "utf8"), "keep");
  await assert.rejects(market.readPackage("../my-plugin/main.js"), /路径/);
  await symlink(join(directory, "main.js"), join(market.root, "packages", "linked.piplug"));
  await assert.rejects(market.readPackage("packages/linked.piplug"), /链接|文件/);
});

test("a publication interrupted before its catalog update can be retried", async (t) => {
  const { directory, market } = await fixture(t);
  const first = await market.publish({ directory });
  await writeFile(join(market.root, "catalog.json"), JSON.stringify({ schemaVersion: 2, name: "我的市场", plugins: [] }));
  const recovered = await market.publish({ directory });
  assert.equal(recovered.sha256, first.sha256);
  assert.equal((await market.catalog()).plugins.length, 1);
  assert.equal((await readdir(join(market.root, "packages"))).length, 1);
});

test("failed exports leave the selected empty directory ready for retry", async (t) => {
  const { base, directory, market } = await fixture(t);
  const publication = await market.publish({ directory });
  const output = join(base, "site"); await mkdir(output);
  const original = await readFile(publication.packagePath);
  await writeFile(publication.packagePath, "broken artifact");
  await assert.rejects(market.export(output), { code: "INTEGRITY" });
  assert.deepEqual(await readdir(output), []);
  await writeFile(publication.packagePath, original);
  await market.export(output);
  assert.ok((await readdir(output)).includes("catalog.json"));
});

test("abandoned initial locks recover, while live publications remain exclusive", async (t) => {
  const { directory, market } = await fixture(t);
  await market.catalog();
  const lock = join(market.root, ".publish-lock");
  await mkdir(lock);
  const old = new Date(Date.now() - 120_000); await utimes(lock, old, old);
  await market.publish({ directory });
  let release, entered;
  const held = new Promise((resolve) => { entered = resolve; });
  const locked = market.lock(async () => { entered(); await new Promise((resolve) => { release = resolve; }); });
  await held;
  try { await assert.rejects(market.publish({ directory }), { code: "BUSY" }); }
  finally { release(); await locked; }
});

test("export refuses market descendants even through an ancestor link", async (t) => {
  const { base, directory, market } = await fixture(t);
  await market.publish({ directory });
  await symlink(market.root, join(base, "linked-market"), "dir");
  await assert.rejects(market.export(join(base, "linked-market", "site")), { code: "INVALID_ARGUMENT" });
});

test("a crashed publisher does not permanently block the creator", async (t) => {
  const { directory, market } = await fixture(t);
  const module = new URL("../../src-tauri/src/plugins/node/personal-market.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import { PersonalMarket } from ${JSON.stringify(module)}; await new PersonalMarket(${JSON.stringify(market.root)}).lock(() => process.exit(0));`]);
  assert.deepEqual(await once(child, "exit"), [0, null]);
  assert.equal((await market.publish({ directory })).id, "mine.notes");
});

test("a crashed lock recovery can itself recover without removing a live publisher", async (t) => {
  const { directory, market } = await fixture(t);
  const module = new URL("../../src-tauri/src/plugins/node/personal-market.mjs", import.meta.url).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { PersonalMarket } from ${JSON.stringify(module)};
    import { mkdir, writeFile } from 'node:fs/promises';
    const market = new PersonalMarket(${JSON.stringify(market.root)});
    await market.lock(async () => {
      const marker = market.root + '/.publish-lock/recovering';
      await mkdir(marker);
      await writeFile(marker + '/owner.json', JSON.stringify({ pid: process.pid }));
      process.exit(0);
    });
  `]);
  assert.deepEqual(await once(child, "exit"), [0, null]);
  assert.equal((await market.publish({ directory })).id, "mine.notes");
});

test("invalid descendant exports do not create directories inside the market", async (t) => {
  const { market } = await fixture(t);
  await market.catalog();
  await assert.rejects(market.export(join(market.root, "new-parent", "site")), { code: "INVALID_ARGUMENT" });
  assert.deepEqual(await readdir(market.root), []);
});

test("market containment handles Windows case, separators and sibling prefixes", () => {
  assert.equal(inside("C:\\Users\\Maker\\Market", "c:\\users\\maker\\market\\site", win32), true);
  assert.equal(inside("C:\\Market", "C:\\Market-other\\site", win32), false);
  assert.equal(inside("C:\\Market", "D:\\Market\\site", win32), false);
});
