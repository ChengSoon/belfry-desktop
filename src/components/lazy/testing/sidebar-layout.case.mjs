import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, press, waitFor, resize, intact, evidence, theme, settings, menuAction, fill } from "./production-uiFixture.mjs";

const collapse = 'button[aria-label="收起侧栏"]';
const reveal = 'button[aria-label="展开侧栏"]';

async function assertLayout(view, collapsed = false) {
  const layout = await view.cdp.evaluate(`(() => {
    const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height, bottom:r.bottom, right:r.right }; };
    return { height:innerHeight, sidebar:rect('.sidebar'), shell:rect('.sidebar-shell'),
      footer:rect('.sidebar-foot'), list:rect('.session-list'), workbench:rect('.workbench'),
      rows:getComputedStyle(document.querySelector('.app-shell')).gridTemplateRows.split(' ').length,
      hidden:document.querySelector('.sidebar-shell').inert,
      visibility:getComputedStyle(document.querySelector('.sidebar')).visibility };
  })()`);
  assert.equal(layout.rows, 1, 'sidebar and workbench must remain in one grid row');
  assert.equal(layout.workbench.y, 0);
  assert.equal(layout.workbench.height, layout.height);
  assert.ok(layout.workbench.width > 0);
  assert.equal(layout.hidden, collapsed);
  if (collapsed) {
    assert.equal(layout.shell.width, 0);
    assert.equal(layout.workbench.x, 0);
    assert.equal(layout.visibility, 'hidden');
  } else {
    assert.equal(layout.sidebar.height, layout.height, 'sidebar fills the window, not just its contents');
    assert.equal(layout.footer.bottom, layout.height, 'tools stay anchored to the bottom');
    assert.ok(layout.list.bottom <= layout.footer.y + 1, 'session scrolling cannot push tools off screen');
    assert.equal(layout.workbench.x, layout.sidebar.right);
    assert.equal(layout.visibility, 'visible');
  }
}

async function toggleSidebar(view, collapsed) {
  await click(view, collapsed ? collapse : reveal);
  await waitFor(view, `document.querySelector('.sidebar-shell').inert === ${collapsed}`);
  await waitFor(view, "document.querySelector('.sidebar').getAnimations().length === 0");
  await assertLayout(view, collapsed);
}

test('sidebar fills tall and short windows, tools stay at bottom, menus escape the rail', { timeout: 60_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await view.cdp.evaluate("void (__productionQA.sidebar = document.querySelector('.sidebar'))");
  for (const mode of ['dark', 'light']) {
    await theme(view, mode);
    for (const [width, height] of [[1888, 1070], [1440, 960], [820, 500]]) {
      await resize(view, width, height);
      await assertLayout(view);
      await evidence(view, `sidebar-${mode}-${width}x${height}`, [collapse, 'button[title^="设置"]', 'button[title^="历史会话"]']);
      await toggleSidebar(view, true);
      await evidence(view, `sidebar-collapsed-${mode}-${width}x${height}`, [reveal]);
      await toggleSidebar(view, false);
    }
  }
  await resize(view, 1440, 960);
  await click(view, '.named-workspaces__trigger');
  await waitFor(view, "!!document.querySelector('.named-workspaces__popover')");
  assert.equal(await view.cdp.evaluate(`(() => {
    const menu = document.querySelector('.named-workspaces__popover'), r = menu.getBoundingClientRect();
    return r.right > document.querySelector('.sidebar').getBoundingClientRect().right &&
      menu.contains(document.elementFromPoint(r.right - 8, r.y + 24));
  })()`), true, 'the part of the workspace menu beyond the sidebar must remain clickable');
  await press(view, 'Escape');
  // Resize is immediate; its user-selected width survives hide/show.
  await view.cdp.evaluate(`document.querySelector('[aria-label="调整侧栏宽度"]').focus()`);
  await press(view, 'ArrowRight');
  const width = await view.cdp.evaluate("document.querySelector('.sidebar').offsetWidth");
  await toggleSidebar(view, true); await toggleSidebar(view, false);
  assert.equal(await view.cdp.evaluate("document.querySelector('.sidebar').offsetWidth"), width);
  assert.equal(await view.cdp.evaluate("__productionQA.sidebar === document.querySelector('.sidebar')"), true);
  await intact(view, baseline);
});

test('sidebar collapse works with every right panel and settings takes the whole window', { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  const panels = [
    { trigger:'button[title^="额度用量"]', panel:'.usage-panel', close:'button[aria-label="关闭用量"]' },
    { trigger:'button[title^="历史会话"]', panel:'.history-panel', close:'button[title="关闭历史会话"]' },
    { trigger:'button[aria-label="文件预览"]', panel:'.file-preview-panel', close:'button[title="关闭文件预览"]' },
    { trigger:'button[aria-label="会话协作"]', panel:'.collab-panel', close:'button[aria-label="关闭协作面板"]' },
    { menu:'插件工作面板', panel:'.plugin-dock:not([hidden])', close:'button[aria-label="关闭工作面板"]' },
  ];
  for (const entry of panels) {
    if (entry.menu) await menuAction(view, entry.menu); else await click(view, entry.trigger);
    await waitFor(view, `!!document.querySelector(${JSON.stringify(entry.panel)})`);
    await assertLayout(view);
    await toggleSidebar(view, true);
    // Open settings through Quick Open while the sidebar and a right panel are retained.
    await click(view, 'button[aria-label="Quick Open"]');
    await waitFor(view, "!!document.querySelector('.quick-open input')");
    await fill(view, '.quick-open input', '设置');
    await press(view, 'Enter');
    await waitFor(view, `!!document.querySelector('button[title="关闭设置"]')`);
    assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar-shell')).display"), 'none');
    assert.deepEqual(await view.cdp.evaluate(`(() => {
      const r = document.querySelector('.settings-view').getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,expectedWidth:innerWidth,expectedHeight:innerHeight};
    })()`), { x:0,y:0,width:1440,height:960,expectedWidth:1440,expectedHeight:960 });
    await click(view, 'button[title="关闭设置"]');
    await waitFor(view, "!document.querySelector('.settings-view')");
    await assertLayout(view, true);
    await toggleSidebar(view, false);
    // Quick Open closes the non-plugin satellite panels as part of existing behavior.
    if (await view.cdp.evaluate(`!!document.querySelector(${JSON.stringify(entry.panel)})`)) await click(view, entry.close);
    await intact(view, baseline);
  }
  await settings(view);
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar-shell')).display"), 'none');
  await click(view, 'button[title="关闭设置"]');
  await waitFor(view, "!document.querySelector('.settings-view')");
  await assertLayout(view);
  await view.send('Emulation.setEmulatedMedia', { features:[{ name:'prefers-reduced-motion', value:'reduce' }] });
  await toggleSidebar(view, true); await toggleSidebar(view, false);
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar')).transitionDuration"), '0s');
  await intact(view, baseline);
});
