import test from "node:test";
import assert from "node:assert/strict";
import { uiFixture, click, clickText, waitFor, capturePanel } from "./production-uiFixture.mjs";

// .sk-list 用 overflow:hidden 裁圆角时，末行插件的作用域菜单会被列表裁掉、选项点不到。
test('installed plugin scope menu on the last row overhangs the list and stays clickable', async t => {
  const { view } = await uiFixture(t, { nativeExtension: "localStorage.setItem('belfry.locale.v1','en');" });
  await click(view, 'button[title^="Settings"]');
  await clickText(view, 'Plugins', '.settings-nav');
  const trigger = '.sk-list > .plugins-row:last-child .scope-compact-trigger';
  await waitFor(view, `!!document.querySelector(${JSON.stringify(trigger)})`);
  await click(view, trigger);
  await waitFor(view, "!!document.querySelector('.scope-compact-menu')");
  const hits = await view.cdp.evaluate(`(() => {
    const menu = document.querySelector('.scope-compact-menu');
    return [...menu.querySelectorAll('button')].map(item => {
      const r = item.getBoundingClientRect();
      return menu.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
  })()`);
  await capturePanel(view, 'plugins-scope-menu-last-row');
  assert.ok(hits.length > 1 && hits.every(Boolean), `scope menu items must be hit-testable: ${JSON.stringify(hits)}`);
});
