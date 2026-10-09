import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { productionFixture, click, press, waitFor } from "./productionFixture.mjs";
import { capturePanel } from "./panelArtifacts.mjs";
export { click, press, waitFor, capturePanel };
export { fill, clickOption } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

export async function uiFixture(t, options = {}) {
  let fixture;
  const browserErrors = [];
  t.after(async () => {
    if (!fixture || t.signal.aborted) return;
    const { view } = fixture;
    await capturePanel(view, `production-ui-final-${t.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 90)}`);
    const health = await view.cdp.evaluate("({ errors: __productionQA.errors, unhandled: __productionQA.unhandled })");
    t.diagnostic(JSON.stringify({ syntheticNativeAdapter: true, realUserData: false, browserErrors, ...health }));
    assert.deepEqual({ browserErrors, ...health }, { browserErrors: [], errors: [], unhandled: [] }, "production browser must have no crashes, errors or unhandled native commands");
  });
  const nativeSource = await readFile(new URL("./production-uiNative.js", import.meta.url), "utf8");
  fixture = await productionFixture(t, { nativeSource: nativeSource + (options.nativeExtension ?? ""), terminalCount: options.terminalCount ?? 2, async beforeNavigate(view) {
    // CI hosts can default to reduced motion. Test normal motion deterministically;
    // reduced-motion cases explicitly switch this media feature after their normal assertions.
    await view.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const listener = ({ sessionId, method, params = {} }) => {
      if (sessionId !== view.sessionId && params.targetId !== view.targetId) return;
      if (method === 'Inspector.targetCrashed' || method === 'Target.targetCrashed') browserErrors.push({ method, params });
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') browserErrors.push({ method, text: params.args.map(arg => arg.value ?? arg.description).join(' ') });
    };
    view.process.on('protocol', listener);
    t.after(() => view.process.off('protocol', listener));
  } });
  const { view } = fixture;
  assert.equal(await view.cdp.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), false,
    "UI fixture must start in normal-motion mode independently of the host preference");
  await resize(view, 1440, 960);
  const baseline = await view.cdp.evaluate("({token: __productionQA.token, creates: __productionQA.creates})");
  return { ...fixture, baseline };
}

export async function resize(view, width, height) {
  await view.bounds({ x: 0, y: 0, width, height });
  await view.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await waitFor(view, `innerWidth === ${width} && innerHeight === ${height}`);
}

// Locate a public DOM button by visible text, then click via real CDP mouse events.
export async function clickText(view, text, scope = "body") {
  await waitFor(view, `[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].some(el => el.textContent.includes(${JSON.stringify(text)}))`);
  const selector = await view.cdp.evaluate(`(() => {
    let el = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(el => el.textContent.includes(${JSON.stringify(text)}));
    const parts = [];
    while (el && el !== document.body) {
      parts.unshift(el.tagName.toLowerCase() + ':nth-child(' + ([...el.parentElement.children].indexOf(el) + 1) + ')'); el = el.parentElement;
    }
    return 'body > ' + parts.join(' > ');
  })()`);
  await click(view, selector);
}

export async function setValue(view, selector, value) {
  await view.cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)}); el.focus();
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
  })()`);
}

export async function intact(view, baseline, extraCreates = 0) {
  assert.deepEqual(await view.cdp.evaluate(`({token: __productionQA.token, creates: __productionQA.creates,
    connected: __productionQA.terminals.every(el => el.isConnected) && __productionQA.input.isConnected,
    removed: __productionQA.removed,
    closes: __productionQA.calls.filter(call => /^(terminal_close|terminal_detach|terminal_close_tab)$/.test(call.command)).length,
    errors: __productionQA.errors, unhandled: __productionQA.unhandled})`),
  { token: baseline.token, creates: baseline.creates + extraCreates, connected: true, removed: 0, closes: 0, errors: [], unhandled: [] });
}

export async function evidence(view, name, controls = []) {
  // Theme changes animate surfaces for 140ms. Capture settled production pixels,
  // not an intermediate blend that can make correct text contrast look broken.
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(resolve => setTimeout(resolve, 240)))");
  await capturePanel(view, `production-ui-${name}`);
  const geometry = await view.cdp.evaluate(`({width: innerWidth, html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth, controls: ${JSON.stringify(controls)}.map(selector => {
      const el = document.querySelector(selector); if (!el) return {selector, missing:true};
      const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return {selector, width:r.width, height:r.height, x:r.x, y:r.y, hit: hit?.tagName,
        reachable: !!hit && el.contains(hit), accessible: !!(el.getAttribute('aria-label') || el.title || el.textContent.trim())};
    })})`);
  assert.ok(geometry.html <= geometry.width + 1 && geometry.body <= geometry.width + 1, `${name}: page horizontal overflow ${JSON.stringify(geometry)}`);
  for (const item of geometry.controls) assert.ok(!item.missing && item.accessible && item.reachable && item.width > 0 && item.height > 0 && item.x >= 0 && item.x + item.width <= geometry.width + 1 && item.y >= 0 && item.y + item.height <= await view.cdp.evaluate("innerHeight"), `${name}: primary operation not reachable ${JSON.stringify(item)}`);
}

export async function menuAction(view, text, legacySelector) {
  if (legacySelector && await view.cdp.evaluate(`!!document.querySelector(${JSON.stringify(legacySelector)})`)) return click(view, legacySelector);
  await click(view, 'button[title="更多工具"]');
  await clickText(view, text, '.workbench-menu');
}

export async function theme(view, mode) {
  if (await view.cdp.evaluate("document.documentElement.dataset.theme") === mode) return;
  await menuAction(view, mode === "light" ? "切换到亮色主题" : "切换到暗色主题", 'button[title*="主题"]');
  await waitFor(view, `document.documentElement.dataset.theme === ${JSON.stringify(mode)}`);
}

export async function settings(view, label) {
  if (!await view.cdp.evaluate("!!document.querySelector('.settings-view')")) await click(view, 'button[title^="设置"]');
  await waitFor(view, "!!document.querySelector('.settings-nav')");
  if (label) await clickText(view, label, '.settings-nav');
}
