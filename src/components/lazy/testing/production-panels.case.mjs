import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, failFirst, assertTerminalIntact, assertTerminalInput, click, press, waitFor } from "./productionFixture.mjs";
import { capturePanel } from "./panelArtifacts.mjs";

const SETTINGS = 'button[title^="设置"]', HISTORY = 'button[title^="历史会话"]';
const RETRY = ".optional-panel-fallback__retry", ALERT = ".optional-panel-fallback [role=alert]";
const settingsJs = /\/assets\/SettingsPanel-[^/?]+\.js(?:\?|$)/;
const settingsCss = /\/assets\/SettingsPanel-[^/?]+\.css(?:\?|$)/;
const sharedJs = /\/assets\/DatePicker-[^/?]+\.js(?:\?|$)/;
const USAGE = 'button[title^="额度用量"]';

for (const [kind, pattern] of [["JS", settingsJs], ["CSS", settingsCss]]) {
  test(`production SettingsPanel recovers after its first ${kind} chunk responds 503`, async (t) => {
    const { view, requests } = await productionFixture(t, { handle: failFirst(pattern) });
    const token = await view.cdp.evaluate("__productionQA.token");
    assert.equal(0, requests.filter((r) => pattern.test(r.url)).length, "关闭面板时不请求可选资源");
    await click(view, SETTINGS);
    await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
    await assertTerminalIntact(view, token);
    await capturePanel(view, `production-settings-${kind}-failed`);
    await click(view, RETRY);
    await waitFor(view, "!!document.querySelector('.settings-nav') && !!document.querySelector('.appearance')");
    await assertTerminalIntact(view, token);
    const attempts = requests.filter((r) => pattern.test(r.url));
    t.diagnostic(JSON.stringify({ attempts, preloadErrors: await view.cdp.evaluate("__productionQA.preloadErrors") }));
    assert.deepEqual([503, 200], attempts.map((r) => r.status));
    assert.match(attempts[1].url, /belfryPanelRetry=/);
    if (kind === "CSS") {
      assert.match(requests.find((r) => /\.css$/.test(r.pathname) && !/\/index-/.test(r.pathname)).url, settingsCss,
        "失败的是首个异步 CSS，而不是开发服务器中的模拟样式");
      assert.equal(true, await view.cdp.evaluate("[...document.styleSheets].some(sheet => /SettingsPanel-.*belfryPanelRetry=/.test(sheet.href ?? '') && sheet.cssRules.length > 0)"));
    }
    await capturePanel(view, `production-settings-${kind}-recovered`);
    await press(view, "Escape");
    await waitFor(view, "!document.querySelector('.settings-view')");
    await assertTerminalInput(view);
    await assertTerminalIntact(view, token);
  });
}

test("production CSS retries remain available and wait for the real stylesheet before rendering", { timeout: 30_000 }, async (t) => {
  let attempts = 0;
  let resolveRequest;
  const requested = new Promise((resolve) => { resolveRequest = resolve; });
  const { view, requests } = await productionFixture(t, { handle(request, response, serve) {
    if (!settingsCss.test(request.url)) return false;
    if (++attempts > 2) { resolveRequest(serve); return true; }
    response.writeHead(503); response.end("test-only repeated CSS failure"); return true;
  } });
  const token = await view.cdp.evaluate("__productionQA.token");
  await click(view, SETTINGS);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  await click(view, RETRY);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  await click(view, RETRY);
  const release = await requested;
  await waitFor(view, "!!document.querySelector('.optional-panel-fallback[aria-busy=true]')");
  assert.equal(false, await view.cdp.evaluate("!!document.querySelector('.settings-nav')"), "CSS 未到达前不暴露无样式面板");
  await assertTerminalIntact(view, token);
  release();
  await waitFor(view, "!!document.querySelector('.settings-nav')");
  assert.deepEqual([503, 503, 200], requests.filter((r) => settingsCss.test(r.url)).map((r) => r.status));
  assert.equal(true, await view.cdp.evaluate("[...document.styleSheets].some(sheet => /SettingsPanel-.*belfryPanelRetry=3/.test(sheet.href ?? '') && sheet.cssRules.length > 0)"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.settings-view')");
  await assertTerminalInput(view);
  await assertTerminalIntact(view, token);
});

test("production shared dependency failure stops ineffective retries and keeps the terminal usable", async (t) => {
  const { view, requests, openWindow } = await productionFixture(t, { handle: failFirst(sharedJs) });
  const token = await view.cdp.evaluate("__productionQA.token");
  await click(view, HISTORY);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  await assertTerminalIntact(view, token);
  await click(view, RETRY);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  t.diagnostic(JSON.stringify({ attempts: requests.filter((r) => /(?:HistoryPanel|DatePicker).*\.js/.test(r.url)),
    preloadErrors: await view.cdp.evaluate("__productionQA.preloadErrors") }));
  assert.equal(false, await view.cdp.evaluate(`!!document.querySelector(${JSON.stringify(RETRY)})`), "静态依赖缓存失败后不能继续提供无效重试");
  assert.match(await view.cdp.evaluate(`document.querySelector(${JSON.stringify(ALERT)}).textContent`), /保存.*终端.*重新打开/);
  await capturePanel(view, "production-shared-dependency-unavailable");
  await click(view, ".optional-panel-fallback__return");
  await waitFor(view, "!document.querySelector('.history-panel')");
  await assertTerminalInput(view);
  await assertTerminalIntact(view, token);
  await click(view, HISTORY);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  assert.equal(false, await view.cdp.evaluate(`!!document.querySelector(${JSON.stringify(RETRY)})`), "关闭后重开也不能重置缓存失败状态");
  assert.equal(2, requests.filter((r) => /HistoryPanel-.*\.js/.test(r.url)).length, "关闭重开不能继续请求失效的入口图");
  await click(view, ".optional-panel-fallback__return");
  await click(view, USAGE);
  await waitFor(view, `!!document.querySelector(${JSON.stringify(ALERT)})`);
  await click(view, RETRY);
  await waitFor(view, "!!document.querySelector('.optional-panel-fallback__return')");
  assert.equal(false, await view.cdp.evaluate(`!!document.querySelector(${JSON.stringify(RETRY)})`), "另一面板也不能循环重试同一共享依赖");
  assert.equal(1, requests.filter((r) => sharedJs.test(r.url)).length, "同一文档缓存了失败的静态依赖");
  await assertTerminalIntact(view, token);
  await click(view, ".optional-panel-fallback__return");
  await click(view, SETTINGS);
  await waitFor(view, "!!document.querySelector('.settings-nav')");
  await assertTerminalIntact(view, token);
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.settings-view')");
  // 新文档可取得已恢复的依赖；另开 QA 窗口，不重载或卸载原文档中的终端。
  const fresh = await openWindow();
  const freshToken = await fresh.cdp.evaluate("__productionQA.token");
  assert.notEqual(token, freshToken);
  await click(fresh, HISTORY);
  await waitFor(fresh, "!!document.querySelector('.history-head')");
  await capturePanel(fresh, "production-shared-dependency-fresh-document");
  await press(fresh, "Escape");
  await click(fresh, USAGE);
  await waitFor(fresh, "!!document.querySelector('.usage-head')");
  assert.deepEqual([503, 200], requests.filter((r) => sharedJs.test(r.url)).map((r) => r.status));
  await assertTerminalIntact(view, token);
  await assertTerminalIntact(fresh, freshToken);
  t.diagnostic(JSON.stringify({ sharedDependencyRequests: requests.filter((r) => sharedJs.test(r.url)),
    originalDocumentRetained: true, freshDocumentRecovered: true }));
});
