import assert from "node:assert/strict";
import test from "node:test";
import { browserFixture, capturePanel, click, press, waitFor } from "./browserFixture.mjs";

const PAGE = "src/components/lazy/testing/panels.html";
const entry = /\/(SettingsPanel|HistoryPanel|UsagePanel|QuickOpen|ShortcutGuide|UpdateDialog)\.tsx(?:\?|$)/;

test("optional imports begin on open and every panel closes without unmounting the workbench", async (t) => {
  const { view, requests } = await browserFixture(t, PAGE);
  await waitFor(view, "!!document.querySelector('#terminal-input')");
  assert.deepEqual([], requests.filter((url) => entry.test(url)));
  const cases = [
    ["settings", ".settings-nav", ".settings-nav__head button", "SettingsPanel"],
    ["history", ".history-head", '.history-head button[title="关闭历史会话"]', "HistoryPanel"],
    ["usage", ".usage-head", '.usage-head button[aria-label="关闭用量"]', "UsagePanel"],
    ["quickOpen", ".quick-open", null, "QuickOpen"],
    ["shortcutGuide", ".shortcut-guide__head", null, "ShortcutGuide"],
    ["updater", ".modal--updater", null, "UpdateDialog"],
  ];
  for (const [name, selector, close, module] of cases) {
    await view.cdp.evaluate(`document.querySelector('#terminal-input').focus();qa.open(${JSON.stringify(name)})`);
    await waitFor(view, `!!document.querySelector(${JSON.stringify(selector)})`);
    assert.ok(requests.some((url) => url.includes(`/${module}.tsx`)), `${module} 应按需请求`);
    if (name === "history" || name === "usage") {
      assert.equal(44, await view.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().height`));
    }
    if (close) await click(view, close); else await press(view, "Escape");
    await waitFor(view, `!document.querySelector(${JSON.stringify(selector)}) && document.activeElement.id==='terminal-input'`);
  }
  assert.deepEqual({ mounted: 1, unmounted: 0, input: "keep my input" }, await view.cdp.evaluate(
    "({mounted:qa.mounted,unmounted:qa.unmounted,input:document.querySelector('#terminal-input').value})"));
});

test("loading can close with Escape; retry preserves width, workbench state and focus", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await waitFor(view, "!!document.querySelector('#terminal-input')");
  await view.cdp.evaluate("localStorage.setItem('belfry.usage-width.v2','380'); document.querySelector('#terminal-input').focus();qa.open('delayed')");
  await waitFor(view, "qa.loadCalls===1 && !!document.querySelector('[role=status]')");
  assert.equal(380, await view.cdp.evaluate("document.querySelector('.optional-panel-fallback').getBoundingClientRect().width"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.optional-panel-fallback') && document.activeElement.id==='terminal-input'");
  await view.cdp.evaluate("qa.open('delayed')");
  await waitFor(view, "!!document.querySelector('.optional-panel-fallback')");
  await view.cdp.evaluate("qa.reject()");
  await waitFor(view, "!!document.querySelector('[role=alert]')");
  await capturePanel(view, "load-failed");
  const ticks = await view.cdp.evaluate("qa.ticks");
  await click(view, ".optional-panel-fallback__retry");
  await waitFor(view, "qa.loadCalls===2 && !!document.querySelector('[role=status]')");
  await view.cdp.evaluate("qa.release()");
  await waitFor(view, "!!document.querySelector('[data-loaded-panel]')");
  assert.ok(await view.cdp.evaluate(`qa.ticks>${ticks} && qa.mounted===1 && qa.unmounted===0`));
  await click(view, "[data-loaded-panel] button");
  await waitFor(view, "document.activeElement.id==='terminal-input'");
});

test("closing a previous panel cannot steal focus from Quick Open during a direct switch", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await waitFor(view, "!!document.querySelector('#terminal-input')");
  await view.cdp.evaluate("document.querySelector('#terminal-input').focus();qa.open('history')");
  await waitFor(view, "!!document.querySelector('.history-head') && document.activeElement.id==='terminal-input'");
  await view.cdp.evaluate("qa.open('quickOpen')");
  await waitFor(view, "document.activeElement?.getAttribute('aria-label')==='搜索会话、项目或动作'");
  await view.send("Input.insertText", { text: "focus stays here" });
  assert.equal("focus stays here", await view.cdp.evaluate("document.querySelector('.quick-open input').value"));
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.quick-open') && document.activeElement.id==='terminal-input'");
});

test("a failed module request can retry through the error boundary", async (t) => {
  let failures = 1;
  const { view } = await browserFixture(t, PAGE, { handle(request, response) {
    if (!request.url.includes("/DeferredPanel.tsx") || failures === 0) return false;
    failures--; response.writeHead(503, { "Content-Type": "text/plain" }); response.end("test-only failure"); return true;
  } });
  await waitFor(view, "!!document.querySelector('#open-network')");
  await click(view, "#open-network");
  await waitFor(view, "!!document.querySelector('[role=alert]')");
  await click(view, ".optional-panel-fallback__retry");
  await waitFor(view, "!!document.querySelector('[data-loaded-panel]')");
  assert.equal(0, await view.cdp.evaluate("qa.unmounted"));
});

test("the real settings module recovers its named export after a failed request", async (t) => {
  let failed = false;
  const { view } = await browserFixture(t, PAGE, { handle(request, response) {
    if (!request.url.includes("/SettingsPanel.tsx") || failed) return false;
    failed = true; response.writeHead(503); response.end("test-only failure"); return true;
  } });
  await waitFor(view, "!!document.querySelector('#open-settings')");
  await click(view, "#open-settings");
  await waitFor(view, "!!document.querySelector('[role=alert]')");
  await click(view, ".optional-panel-fallback__retry");
  await waitFor(view, "!!document.querySelector('.settings-nav') && !!document.querySelector('.appearance')");
  await press(view, "Escape");
  await waitFor(view, "!document.querySelector('.settings-view')");
  assert.equal(0, await view.cdp.evaluate("qa.unmounted"));
});

test("CSS preload failure retries the stylesheet before exposing the loaded panel", async (t) => {
  let attempts = 0;
  const { view } = await browserFixture(t, PAGE, { handle(request, response) {
    if (!request.url.startsWith("/__panel-styles.css")) return false;
    attempts++;
    response.writeHead(attempts === 1 ? 503 : 200, { "Content-Type": "text/css" });
    response.end(attempts === 1 ? "" : "[data-loaded-panel] { --qa-style-ready: 1; }");
    return true;
  } });
  await waitFor(view, "!!document.querySelector('#terminal-input')");
  await view.cdp.evaluate("qa.open('styled')");
  await waitFor(view, "!!document.querySelector('[role=alert]')");
  await click(view, ".optional-panel-fallback__retry");
  await waitFor(view, "!!document.querySelector('[data-loaded-panel]')");
  assert.equal("1", await view.cdp.evaluate("getComputedStyle(document.querySelector('[data-loaded-panel]')).getPropertyValue('--qa-style-ready').trim()"));
  assert.equal(2, attempts);
});

test("lazy styles preserve the shared panel shell at narrow and wide window sizes", async (t) => {
  const { view } = await browserFixture(t, PAGE);
  await waitFor(view, "!!document.querySelector('#open-settings')");
  for (const [width, height, theme] of [[720, 480, "light"], [1440, 900, "dark"]]) {
    await view.bounds({ x: 0, y: 0, width, height });
    await view.cdp.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    for (const [name, selector] of [["settings", ".settings-nav"], ["history", ".history-head"], ["usage", ".usage-head"]]) {
      await view.cdp.evaluate(`qa.open(${JSON.stringify(name)})`);
      await waitFor(view, `!!document.querySelector(${JSON.stringify(selector)})`);
      const fits = await view.cdp.evaluate(`(()=>{
        const element=document.querySelector(${JSON.stringify(name === "settings" ? ".settings-view" : `.${name}-panel`)});
        const rect=element.getBoundingClientRect();
        return rect.left>=0 && rect.right<=innerWidth && rect.height>0 && rect.bottom<=innerHeight;
      })()`);
      assert.equal(true, fits, `${name} should fit ${width}×${height}`);
      await capturePanel(view, `${name}-${theme}-${width}`);
      await view.cdp.evaluate("qa.open('')");
      await waitFor(view, `!document.querySelector(${JSON.stringify(selector)})`);
    }
  }
});
