import assert from "node:assert/strict";
import test from "node:test";
import { browserAvailable } from "./panel-support.mjs";
import { BELFRY_SOURCE } from "../../src-tauri/src/plugins/node/market-catalog.mjs";
import { marketUiFixture, SOURCE_SELECT, CUSTOM_INPUT, click, fill, selectSource, enter, waitFor, pageState, screenshot } from "./market-ui-support.mjs";

const PERSONAL = { pluginMarketSource: "personal", pluginMarketCustomUrl: "" };
const BELFRY = { pluginMarketSource: "belfry", pluginMarketCustomUrl: "" };
const READY = `!document.querySelector(${JSON.stringify(SOURCE_SELECT)})?.disabled && document.querySelector('.pi-plugins')?.getAttribute('aria-busy')==='false'`;

function unpublishedBelfry(t) {
  const fetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (url, options) => url === BELFRY_SOURCE ? Promise.resolve(new Response(null, { status: 404 })) : fetch(url, options));
}

test("market page keeps its selected provider, saved settings and cards after Belfry GitHub returns 404", async (t) => {
  if (!await browserAvailable(t)) return;
  unpublishedBelfry(t);
  const f = await marketUiFixture(t); await f.open();
  await waitFor(f.view, "document.querySelector('.plugins-card-name')?.textContent==='我的笔记'");
  const aligned = await f.view.cdp.evaluate(`(()=>{const source=document.querySelector(${JSON.stringify(SOURCE_SELECT)}).getBoundingClientRect();const name=document.querySelector('.plugins-market-name input').getBoundingClientRect();return source.width===name.width&&source.right===name.right;})()`);
  assert.equal(true, aligned, "来源控件应与同列输入框对齐");
  await selectSource(f.view, "belfry");
  await waitFor(f.view, "document.querySelector('[role=alert]')?.textContent.includes('HTTP 404')");
  await waitFor(f.view, READY);
  const state = await pageState(f.view);
  assert.equal("personal", state.source); assert.deepEqual(["我的笔记"], state.cards);
  assert.match(state.errors.join("\n"), /Belfry GitHub.*尚未发布/);
  assert.deepEqual(PERSONAL, f.management.snapshot().settings);
  await screenshot(f.view, "belfry-source-404");
  await fill(f.view, 'input[aria-label="搜索插件"]', "不存在");
  await waitFor(f.view, "document.querySelectorAll('.plugins-card-name').length===0");
  await fill(f.view, 'input[aria-label="搜索插件"]', "笔记");
  await waitFor(f.view, "document.querySelector('.plugins-card-name')?.textContent==='我的笔记'");
  await click(f.view, ".plugins-card-hit");
  await waitFor(f.view, "!!document.querySelector('.plugins-readme')");
  const detail = await f.view.cdp.evaluate("document.querySelector('[role=dialog]').textContent");
  assert.match(detail, /mine\.notes/); assert.match(detail, /说明文档/); assert.match(detail, /显示插件面板/);
  await screenshot(f.view, "personal-market-detail");
});

test("market page can recover an old unavailable Belfry selection using its local recovery button", async (t) => {
  if (!await browserAvailable(t)) return;
  unpublishedBelfry(t);
  const f = await marketUiFixture(t, BELFRY); await f.open();
  await waitFor(f.view, "document.querySelector('[role=alert]')?.textContent.includes('HTTP 404')");
  assert.deepEqual([], (await pageState(f.view)).cards);
  await f.view.cdp.evaluate("document.querySelectorAll('button').forEach(button=>{if(button.textContent==='使用我的插件市场')button.setAttribute('data-test-recover','true')})");
  await click(f.view, "button[data-test-recover]");
  await waitFor(f.view, "document.querySelector('.plugins-card-name')?.textContent==='我的笔记'");
  await waitFor(f.view, READY);
  const state = await pageState(f.view);
  assert.equal("personal", state.source); assert.deepEqual([], state.errors);
  assert.deepEqual(PERSONAL, f.management.snapshot().settings);
  await screenshot(f.view, "recovered-personal-market");
});

test("editing a custom address does not disable the provider control when it receives a click", async (t) => {
  if (!await browserAvailable(t)) return;
  const f = await marketUiFixture(t); await f.open();
  await selectSource(f.view, "custom");
  await waitFor(f.view, `!!document.querySelector(${JSON.stringify(CUSTOM_INPUT)}) && (${READY})`);
  f.routes.set("/missing/catalog.json", { status: 404 });
  await fill(f.view, CUSTOM_INPUT, `${f.origin}/missing/catalog.json`);
  await click(f.view, SOURCE_SELECT);
  const control = await f.view.cdp.evaluate(`({disabled:document.querySelector(${JSON.stringify(SOURCE_SELECT)}).disabled,focused:document.activeElement===document.querySelector(${JSON.stringify(SOURCE_SELECT)})})`);
  assert.deepEqual(control, { disabled: false, focused: true });
  await selectSource(f.view, "personal");
  await waitFor(f.view, "document.querySelector('.plugins-card-name')?.textContent==='我的笔记'");
  await waitFor(f.view, READY);
  assert.deepEqual(PERSONAL, f.management.snapshot().settings);
});

test("custom market addresses are validated on submission and a failed replacement keeps the previous catalog", async (t) => {
  if (!await browserAvailable(t)) return;
  const f = await marketUiFixture(t); await f.open();
  const catalog = structuredClone(await f.market.personal.catalog());
  catalog.plugins[0].id = "remote.notes"; catalog.plugins[0].name = "在线笔记";
  f.routes.set("/online/catalog.json", { body: catalog }); f.routes.set("/missing/catalog.json", { status: 404 });
  await selectSource(f.view, "custom");
  await waitFor(f.view, `!!document.querySelector(${JSON.stringify(CUSTOM_INPUT)}) && (${READY})`);
  assert.deepEqual([], (await pageState(f.view)).cards);
  const source = `${f.origin}/online/catalog.json`;
  await fill(f.view, CUSTOM_INPUT, source); await click(f.view, '.plugins-market-url-form button[type="submit"]');
  await waitFor(f.view, "document.querySelector('.plugins-card-name')?.textContent==='在线笔记'");
  await waitFor(f.view, READY);
  await fill(f.view, CUSTOM_INPUT, `${f.origin}/missing/catalog.json`); await enter(f.view);
  await waitFor(f.view, "document.querySelector('[role=alert]')?.textContent.includes('HTTP 404')");
  await waitFor(f.view, READY);
  const state = await pageState(f.view);
  assert.deepEqual(["在线笔记"], state.cards); assert.match(state.sourceUrl, /online\/catalog\.json/);
  assert.deepEqual({ pluginMarketSource: "custom", pluginMarketCustomUrl: source }, f.management.snapshot().settings);
  await screenshot(f.view, "custom-source-404");
  await f.view.bounds({ x: 0, y: 0, width: 640, height: 900 });
  const fits = await f.view.cdp.evaluate("[...document.querySelectorAll('.plugins-market-url-form input,.plugins-market-url-form button')].every(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth})");
  assert.equal(true, fits);
  await screenshot(f.view, "custom-source-narrow");
});
