import assert from "node:assert/strict";
import test from "node:test";
import { productionFixture, assertTerminalIntact, click, waitFor, failFirst } from "./productionFixture.mjs";
import { clickOption, fill } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

const nativeSource = `(() => {
  if (!sessionStorage.getItem('qa-locale-started')) {
    localStorage.removeItem('belfry.locale.v1'); sessionStorage.setItem('qa-locale-started', '1');
  }
  Object.defineProperty(navigator, 'languages', { configurable: true, value: ['en-US'] });
})();`;

test("language switching is immediate, persists and preserves the terminal and settings input", async (t) => {
  const { view } = await productionFixture(t, { nativeSource });
  const token = await view.cdp.evaluate("__productionQA.token");
  assert.equal(await view.cdp.evaluate("document.documentElement.lang"), "en");
  await click(view, 'button[title^="Settings"]');
  await waitFor(view, "!!document.querySelector('#app-language')");
  assert.equal(await view.cdp.evaluate("document.querySelector('#app-language').textContent"), "Follow system");
  assert.equal(await view.cdp.evaluate("document.querySelector('#app-language').tagName"), "BUTTON");
  await fill(view, ".settings-search input", "font");
  await view.cdp.evaluate("void (window.qaSettingsInput = document.querySelector('.settings-search input'))");
  await click(view, "#app-language"); await clickOption(view, "简体中文");
  await waitFor(view, "document.documentElement.lang === 'zh-CN' && document.querySelector('#settings-title').textContent === '设置'");
  assert.equal(await view.cdp.evaluate("document.querySelector('.settings-search input') === window.qaSettingsInput && window.qaSettingsInput.value === 'font'"), true);
  await click(view, "#app-language"); await clickOption(view, "English");
  await waitFor(view, "document.documentElement.lang === 'en' && document.querySelector('#settings-title').textContent === 'Settings'");
  await waitFor(view, "__productionQA.calls.filter(call => call.command === 'app_set_locale').map(call => call.args.locale).join(',') === 'en,zh-CN,en'");
  await assertTerminalIntact(view, token);
  await click(view, 'button[title="Close settings"]');
  await click(view, ".xterm-screen");
  await waitFor(view, "document.activeElement === document.querySelector('.xterm-helper-textarea')");
  await view.send("Input.insertText", { text: "language-switch-keeps-input" });
  await waitFor(view, "__productionQA.writes.some(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('language-switch-keeps-input'))");
  await view.send("Page.reload");
  await waitFor(view, "!!document.querySelector('.xterm') && document.documentElement.lang === 'en'");
  assert.equal(await view.cdp.evaluate("localStorage.getItem('belfry.locale.v1')"), "en");
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'app_set_locale' && call.args.locale === 'en')");
});

test("following the system reacts to language changes and English settings fit a 720x480 window", async (t) => {
  const { view } = await productionFixture(t, { nativeSource });
  await view.bounds({ x: 0, y: 0, width: 720, height: 480 });
  await click(view, 'button[title^="Settings"]');
  await waitFor(view, "!!document.querySelector('#app-language')");
  await click(view, "#app-language"); await clickOption(view, "Follow system");
  await view.cdp.evaluate("Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-Hans'] }); window.dispatchEvent(new Event('languagechange'))");
  await waitFor(view, "document.documentElement.lang === 'zh-CN'");
  assert.equal(await view.cdp.evaluate("localStorage.getItem('belfry.locale.v1')"), "system");
  await click(view, "#app-language"); await clickOption(view, "English");
  await view.cdp.evaluate("window.dispatchEvent(new Event('languagechange'))");
  assert.equal(await view.cdp.evaluate("document.documentElement.lang"), "en");
  assert.equal(await view.cdp.evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  assert.equal(await view.cdp.evaluate("document.querySelector('.settings-content').scrollWidth <= document.querySelector('.settings-content').clientWidth"), true);
  await click(view, 'button[title="Close settings"]');
  await waitFor(view, "!document.querySelector('.settings-view')");
});

test("an open panel failure translates its title without losing the retry state", async (t) => {
  const { view } = await productionFixture(t, { handle: failFirst(/\/assets\/SettingsPanel-[^/]+\.js/) });
  await click(view, 'button[title^="设置"]');
  await waitFor(view, "!!document.querySelector('.optional-panel-fallback [role=alert]')");
  await view.cdp.evaluate("localStorage.setItem('belfry.locale.v1', 'en'); window.dispatchEvent(new StorageEvent('storage', { key: 'belfry.locale.v1', newValue: 'en' }))");
  await waitFor(view, "document.documentElement.lang === 'en'");
  assert.equal(await view.cdp.evaluate("document.querySelector('.optional-panel-fallback h2').textContent"), "Settings");
  assert.equal(await view.cdp.evaluate("document.querySelector('.optional-panel-fallback__retry').textContent"), "Reload");
  await click(view, ".optional-panel-fallback__retry");
  await waitFor(view, "document.querySelector('#settings-title')?.textContent === 'Settings'");
});
