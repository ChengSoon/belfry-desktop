import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { temporary } from "./support.mjs";
import { PluginManagement } from "../../src-tauri/src/plugins/node/management.mjs";
import { PluginMarket } from "../../src-tauri/src/plugins/node/market.mjs";

async function fixture(t) {
  const base = await temporary(t), bytes = Buffer.from("package fixture");
  const version = { version: "1.0.0", url: "packages/example.piplug", shasum: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, permissions: ["ui.panel"] };
  const catalog = { schemaVersion: 2, providerId: "test", plugins: [{ id: "local.market", name: "Market", description: "test", author: "test", trust: "verified", versions: [version] }] };
  let offline = false, packageBytes = bytes;
  const server = createServer((request, response) => {
    if (offline) { response.writeHead(503); response.end(); return; }
    if (request.url.endsWith(".piplug")) { response.end(packageBytes); return; }
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(catalog));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const source = `http://127.0.0.1:${server.address().port}/catalog.json`;
  const management = new PluginManagement(base); await management.init();
  await management.setSource({ pluginMarketSource: "custom", pluginMarketCustomUrl: source });
  let installed = [];
  const market = new PluginMarket({ base, management, installed: () => installed });
  return { base, market, management, catalog, version, bytes, source,
    offline: () => { offline = true; }, corrupt: () => { packageBytes = Buffer.from("tampered"); }, installed: (value) => { installed = value; } };
}
test("market resolves artifacts, downgrades custom trust and retains a source-specific offline catalog", async (t) => {
  const f = await fixture(t); await f.market.refresh();
  assert.equal((await f.market.search({})).plugins[0].trust, "community");
  const detail = await f.market.detail("local.market");
  assert.equal(detail.versions[0].url, new URL("packages/example.piplug", f.source).href);
  f.offline();
  await assert.rejects(f.market.refresh());
  assert.equal((await f.market.search({})).plugins.length, 1);
  await f.management.setSource({ pluginMarketSource: "custom", pluginMarketCustomUrl: "http://127.0.0.1:1/other.json" });
  assert.equal((await f.market.search({})).plugins.length, 0);
});
test("market rejects withdrawn versions and verifies downloaded bytes", async (t) => {
  const f = await fixture(t);
  const prepared = await f.market.prepare({ id: "local.market", version: "1.0.0" });
  assert.deepEqual(await readFile(prepared.path), f.bytes);
  f.corrupt();
  await assert.rejects(f.market.prepare({ id: "local.market", version: "1.0.0" }), /INTEGRITY|摘要/);
  f.version.yanked = true;
  await assert.rejects(f.market.prepare({ id: "local.market", version: "1.0.0" }), /YANKED|撤回/);
});
test("automatic updates skip new permissions and expanded file scopes", async (t) => {
  const f = await fixture(t);
  f.installed([{ id: "local.market", version: "0.9.0", enabled: true, permissions: ["ui.panel"], fs: {} }]);
  await f.management.setPlugin("local.market", { autoUpdate: true });
  await f.market.refresh();
  assert.equal((await f.market.updatePlan()).updates.length, 1);
  f.version.permissions.push("fs.write"); f.version.fs = { write: { scope: ["notes/**"] } };
  await f.market.refresh();
  assert.equal((await f.market.updatePlan()).updates.length, 0);
  assert.deepEqual((await f.market.updatePlan()).skipped, ["local.market"]);
  const restored = new PluginManagement(f.base); await restored.init();
  assert.equal(restored.snapshot().plugins["local.market"].autoUpdate, true);
});

test("market minimum host versions are checked before installing", async (t) => {
  const f = await fixture(t);
  f.version.minPiDesktop = "99.0.0";
  await assert.rejects(f.market.prepare({ id: "local.market" }), { code: "INCOMPATIBLE" });
});

test("automatic updates keep the plugin's original marketplace identity", async (t) => {
  const f = await fixture(t);
  f.installed([{ id: "local.market", version: "0.9.0", enabled: true, permissions: ["ui.panel"] }]);
  await f.management.setPlugin("local.market", { autoUpdate: true, marketplace: { providerId: "https://original.example/catalog.json" } });
  await f.market.refresh();
  assert.deepEqual((await f.market.updatePlan()).skipped, ["local.market"]);
});

test("Belfry GitHub catalog has a persistent identity separate from the PI catalogs", async (t) => {
  const base = await temporary(t), management = await new PluginManagement(base).init();
  const market = new PluginMarket({ base, management, installed: () => [] });
  assert.equal("belfry-market://personal/catalog.json", market.source());
  await management.setSource({ pluginMarketSource: "belfry", pluginMarketCustomUrl: "" });
  assert.equal("https://raw.githubusercontent.com/ChengSoon/belfry-desktop-plugins/main/catalog.json", market.source());
  const restored = await new PluginManagement(base).init();
  assert.equal("belfry", restored.snapshot().settings.pluginMarketSource);
  await management.setSource({ pluginMarketSource: "official", pluginMarketCustomUrl: "" });
  assert.equal("https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json", market.source());
  await management.setSource({ pluginMarketSource: "mirror", pluginMarketCustomUrl: "" });
  assert.equal("https://cnb.cool/aixk/pi-desktop-plugins/-/git/raw/main/catalog.json", market.source());
});
