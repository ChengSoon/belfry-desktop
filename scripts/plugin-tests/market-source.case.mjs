import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { temporary } from "./support.mjs";
import { administration } from "../../src-tauri/src/plugins/node/administration.mjs";
import { PluginManagement } from "../../src-tauri/src/plugins/node/management.mjs";
import { PluginMarket } from "../../src-tauri/src/plugins/node/market.mjs";
import { BELFRY_SOURCE, download } from "../../src-tauri/src/plugins/node/market-catalog.mjs";

const PERSONAL = { pluginMarketSource: "personal", pluginMarketCustomUrl: "" };
const BELFRY = { pluginMarketSource: "belfry", pluginMarketCustomUrl: "" };
const CATALOG = { schemaVersion: 2, providerId: "own", plugins: [] };

async function fixture(t) {
  const base = await temporary(t), management = await new PluginManagement(base).init();
  await management.setSource(PERSONAL);
  const market = new PluginMarket({ base, management, installed: () => [] });
  const select = (settings) => administration({ management, market }, "management.source", { settings });
  return { base, management, market, select };
}

test("an unpublished Belfry GitHub catalog keeps the usable source and its saved settings", async (t) => {
  const { base, management, market, select } = await fixture(t);
  const before = await readFile(join(base, "management.json"));
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(BELFRY_SOURCE, url);
    return new Response(null, { status: 404 });
  });
  await assert.rejects(select(BELFRY), (error) => {
    assert.equal("MARKET_NOT_FOUND", error.code);
    assert.match(error.message, /Belfry.*GitHub/);
    assert.match(error.message, /我的插件市场/);
    assert.match(error.message, /catalog\.json/);
    return true;
  });
  assert.deepEqual(PERSONAL, management.snapshot().settings);
  assert.deepEqual(before, await readFile(join(base, "management.json")));
  assert.equal("belfry-market://personal/catalog.json", (await market.search()).sourceUrl);
});

test("a new source is validated and cached before its settings are committed", async (t) => {
  const { management, market, select } = await fixture(t);
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    assert.deepEqual(PERSONAL, management.snapshot().settings);
    return Response.json(CATALOG);
  });
  await select(BELFRY);
  assert.equal(1, requests);
  assert.deepEqual(BELFRY, management.snapshot().settings);
  assert.deepEqual({ plugins: [], sourceUrl: BELFRY_SOURCE, cached: true }, await market.search());
});

test("a repository web page cannot replace a working market catalog", async (t) => {
  const { management, select } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => new Response("<!doctype html><title>Repository</title>"));
  await assert.rejects(select({ pluginMarketSource: "custom", pluginMarketCustomUrl: "https://github.com/example/plugins" }), { code: "MARKET_INVALID" });
  assert.deepEqual(PERSONAL, management.snapshot().settings);
});

test("a missing custom catalog reports its file address without disclosing query parameters", async (t) => {
  const { management, select } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  await assert.rejects(select({ pluginMarketSource: "custom", pluginMarketCustomUrl: "https://example.test/catalog.json?access=request-only-value" }), (error) => {
    assert.equal("MARKET_NOT_FOUND", error.code);
    assert.match(error.message, /https:\/\/example\.test\/catalog\.json/);
    assert.doesNotMatch(error.message, /request-only-value/);
    return true;
  });
  assert.deepEqual(PERSONAL, management.snapshot().settings);
});

test("missing packages are distinguished from an unpublished catalog", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 404 }));
  await assert.rejects(download("https://example.test/packages/note.piplug"), (error) => {
    assert.equal("PACKAGE_NOT_FOUND", error.code);
    assert.match(error.message, /插件包/);
    assert.match(error.message, /note\.piplug/);
    return true;
  });
});

test("an old unavailable selection can recover locally without a network request", async (t) => {
  const { management, market, select } = await fixture(t);
  await management.setSource(BELFRY);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("local recovery must not use the network"); });
  await select(PERSONAL);
  assert.deepEqual(PERSONAL, management.snapshot().settings);
  assert.equal(true, (await market.search()).cached);
});

test("an empty custom address remains editable without attempting a request", async (t) => {
  const { management, select } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("an empty address must not be requested"); });
  const settings = { pluginMarketSource: "custom", pluginMarketCustomUrl: "" };
  await select(settings);
  assert.deepEqual(settings, management.snapshot().settings);
});

test("a previously validated source stays selectable from its own offline cache", async (t) => {
  const { management, market, select } = await fixture(t);
  t.mock.method(globalThis, "fetch", async () => Response.json(CATALOG));
  await select(BELFRY); await select(PERSONAL);
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  await select(BELFRY);
  assert.deepEqual(BELFRY, management.snapshot().settings);
  assert.equal(true, (await market.search()).cached);
});
