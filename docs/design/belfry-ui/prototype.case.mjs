import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, click, fill, press, wait, screenshot, assertClean } from './browser-fixture.mjs';

const id = name => `[data-testid="${name}"]`;
const selectorFor = route => `[data-route=${JSON.stringify(route)}]`;
const body = view => view.cdp.evaluate('document.querySelector("main").innerText');

// Tests intentionally exercise DOM controls; no Tauri/native mocks or live user data.
test('all prototype navigation and settings entries render real content', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, '!!document.querySelector("[data-route]")');
  const primary = await view.cdp.evaluate('[...new Set([...document.querySelectorAll("#sidebar [data-route]")].map(e=>e.dataset.route))]');
  assert.ok(primary.length >= 8, 'Global shell exposes all main areas');
  const seen = new Set();
  for (const route of primary) {
    await click(view, selectorFor(route));
    assert.ok((await body(view)).trim().length > 80, `Content for ${route}`);
    seen.add(route);
    if (route === 'settings' || route.startsWith('settings/')) {
      const settings = await view.cdp.evaluate('[...new Set([...document.querySelectorAll(".settings-nav [data-route]")].map(e=>e.dataset.route))]');
      assert.equal(settings.length, 11, 'Every settings category is present');
      for (const child of settings) {
        await click(view, selectorFor(child));
        assert.ok((await body(view)).trim().length > 80, `Settings content for ${child}`);
        seen.add(child);
      }
    }
  }
  t.diagnostic(JSON.stringify({routes:[...seen]}));
  await assertClean(f);
});

test('theme, visual variants and viewport changes keep the shell within the viewport', { timeout: 60000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, `!!document.querySelector('${id('variant-select')}')`);
  await screenshot(view, 'workspace-graphite-dark');
  await click(view, id('theme-toggle'));
  assert.equal(await view.cdp.evaluate('document.documentElement.dataset.theme'), 'light');
  await screenshot(view, 'workspace-graphite-light');
  await click(view, id('theme-toggle'));
  for (const variant of ['graphite','paper','compact']) {
    await fill(view, id('variant-select'), variant);
    assert.equal(await view.cdp.evaluate('document.documentElement.dataset.variant'), variant);
    if (variant === 'compact' && await view.cdp.evaluate('document.documentElement.dataset.theme === "light"')) await click(view, id('theme-toggle'));
    for (const [width,height] of [[1440,960],[1024,768],[820,900]]) {
      await view.bounds({x:0,y:0,width,height});
      const metrics = await view.cdp.evaluate('({w:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector("main").getBoundingClientRect().width})');
      assert.ok(metrics.scroll <= metrics.w + 1, `${variant} at ${width} has no page-level horizontal overflow`);
      assert.ok(metrics.main > 200, 'Main content remains usable');
    }
    await view.bounds({x:0,y:0,width:1440,height:960});
    await screenshot(view, `workspace-${variant}`);
  }
  await assertClean(f);
});

test('Quick Open accepts keyboard navigation, Escape and restores focus', { timeout: 30000 }, async t => {
  const f = await fixture(t), { view } = f;
  await wait(view, `!!document.querySelector('${id('quick-open')}')`);
  await view.cdp.evaluate(`document.querySelector('${id('quick-open')}').focus();true`);
  await press(view, 'k', 2);
  await wait(view, '!!document.querySelector("dialog[open]")');
  const contentScroll = await view.cdp.evaluate('document.querySelector("main").scrollTop');
  for (let i=0;i<15;i++) await press(view, 'ArrowDown');
  assert.ok(await view.cdp.evaluate('document.querySelector("#quick-results").scrollTop > 0'), 'Only the result list scrolls to selected options');
  assert.equal(await view.cdp.evaluate('document.querySelector("main").scrollTop'), contentScroll);
  const search = 'dialog[open] input';
  await fill(view, search, 'Provider');
  assert.match(await view.cdp.evaluate('document.querySelector("dialog[open]").innerText'), /Provider/);
  await press(view,'Escape');
  await wait(view,'!document.querySelector("dialog[open]")');
  assert.equal(await view.cdp.evaluate('document.activeElement.dataset.testid'),'quick-open');
  await click(view, id('quick-open'));
  await fill(view, search, '用量');
  await press(view,'Enter');
  await wait(view,'!document.querySelector("dialog[open]")');
  assert.match(await body(view),/用量/);
  await assertClean(f);
});
