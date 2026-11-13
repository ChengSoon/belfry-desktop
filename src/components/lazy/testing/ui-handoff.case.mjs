import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { uiFixture, click, clickText, resize, settings, theme, waitFor, intact } from "./production-uiFixture.mjs";

const OUT = process.env.BELFRY_HANDOFF_ARTIFACTS;
async function capture(view, name) {
  if (!OUT) return;
  await mkdir(OUT, { recursive: true });
  await view.cdp.evaluate("document.fonts.ready.then(() => new Promise(r => setTimeout(r, 240)))");
  const { data } = await view.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
}

test("branch crumb does not poll status, refreshes on focus, and handles detached/error/non-repository states", { timeout: 30_000 }, async t => {
  const { view, baseline } = await uiFixture(t, { nativeExtension: `(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    __productionQA.branchValue = { repository: true, branch: 'main', detached: null };
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command !== 'git_branch') return original(command, args);
      __productionQA.calls.push({ command, args });
      if (__productionQA.branchValue === 'error') throw new Error('Synthetic branch read failure');
      return structuredClone(__productionQA.branchValue);
    };
  })();` });
  await waitFor(view, "document.querySelector('.workbench-crumb__branch')?.textContent.includes('main')");
  const counts = () => view.cdp.evaluate("({ branch: __productionQA.calls.filter(c => c.command === 'git_branch').length, status: __productionQA.calls.filter(c => c.command === 'git_status').length })");
  const initial = await counts();
  assert.equal(initial.status, 0);
  await view.cdp.evaluate("new Promise(r => setTimeout(r, 6500))");
  assert.deepEqual(await counts(), initial, "idle toolbar must issue no periodic Git reads");
  const refresh = value => view.cdp.evaluate(`__productionQA.branchValue = ${JSON.stringify(value)}; window.dispatchEvent(new Event('focus'));`);
  await refresh({ repository: true, branch: null, detached: "a1b2c3d" });
  await waitFor(view, "document.querySelector('.workbench-crumb__branch')?.title === '分离 HEAD · a1b2c3d'");
  assert.equal(await view.cdp.evaluate("document.querySelector('.workbench-crumb__branch').textContent.includes('(detached)')"), false);
  await capture(view, "workbench-detached-dark");
  for (const value of [{ repository: false, branch: null, detached: null }, "error"]) {
    await refresh(value);
    await waitFor(view, "!document.querySelector('.workbench-crumb__branch')");
  }
  await refresh({ repository: true, branch: "feature/恢复", detached: null });
  await waitFor(view, "document.querySelector('.workbench-crumb__branch')?.textContent.includes('feature/恢复')");
  const group = await view.cdp.evaluate("({ role: document.querySelector('.workbench-tabs').getAttribute('role'), label: document.querySelector('.workbench-tabs').getAttribute('aria-label'), tabs: document.querySelectorAll('[role=tab]').length, current: document.querySelectorAll('.workbench-tabs [aria-current=page]').length })");
  assert.deepEqual(group, { role: "group", label: "同项目会话", tabs: 0, current: 1 });
  await click(view, ".workbench-tab:nth-child(2)");
  assert.ok(await view.cdp.evaluate("document.querySelector('.workbench-tab:nth-child(2)').getAttribute('aria-current') === 'page'"));
  await intact(view, baseline);
  t.diagnostic(JSON.stringify({ gitCallsBefore: initial, gitCallsAfter: await counts() }));
});

test("busy Provider form gives secondary and primary buttons a disabled appearance without hover feedback", { timeout: 30_000 }, async t => {
  const { view } = await uiFixture(t, { nativeExtension: `(() => {
    const original = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === 'provider_save') await new Promise(resolve => { __productionQA.finishSave = resolve; });
      return original(command, args);
    };
  })();` });
  await settings(view, "全局 Provider");
  await click(view, '.provider-card button[aria-label^="编辑 "]');
  await clickText(view, "保存配置", ".provider-form");
  await waitFor(view, "!!__productionQA.finishSave && document.querySelector('.provider-form .modal__actions button').disabled");
  const selector = ".provider-form .modal__actions button:first-child";
  const paint = () => view.cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}), s = getComputedStyle(el); return { opacity: s.opacity, cursor: s.cursor, background: s.backgroundColor, shadow: s.boxShadow }; })()`);
  const before = await paint();
  assert.equal(before.opacity, "0.45");
  assert.equal(before.cursor, "default");
  const rect = await view.cdp.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await view.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...rect });
  await view.cdp.evaluate("new Promise(r => setTimeout(r, 200))");
  assert.deepEqual(await paint(), before);
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.provider-form .modal__primary')).opacity"), "0.45");
  await capture(view, "provider-busy-dark");
  await view.cdp.evaluate("__productionQA.finishSave()");
  await waitFor(view, "!document.querySelector('.provider-form')");
});

test("settings Provider rows use the available width with one, two, or three cards", { timeout: 30_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  for (const mode of ["dark", "light"]) {
    if (await view.cdp.evaluate("!!document.querySelector('.settings-view')")) await click(view, 'button[title="关闭设置"]');
    await theme(view, mode);
    for (const count of [1, 2, 3]) {
      await settings(view, "外观");
      await view.cdp.evaluate(`(() => {
        const group = __productionQA.catalog.agents.find(agent => agent.kind === 'claude'), first = group.providers[0];
        group.providers = Array.from({ length: ${count} }, (_, index) => ({ ...first, id: 'claude-width-' + index, name: 'Synthetic service ' + (index+1) }));
      })()`);
      await settings(view, "全局 Provider");
      await waitFor(view, `document.querySelectorAll('.provider-card').length === ${count}`);
      const row = await view.cdp.evaluate(`(() => {
        const list = document.querySelector('.provider-list').getBoundingClientRect(), cards = [...document.querySelectorAll('.provider-card')].map(el=>el.getBoundingClientRect());
        return { left: cards[0].left-list.left, right: list.right-cards.at(-1).right, widths: cards.map(r=>r.width) };
      })()`);
      assert.ok(Math.abs(row.left) <= 1 && Math.abs(row.right) <= 1, `no empty right-hand tracks: ${JSON.stringify(row)}`);
      assert.ok(Math.max(...row.widths)-Math.min(...row.widths) <= 1, "cards divide the available width equally");
      await capture(view, `provider-${count}-cards-${mode}-1440x960`);
    }
  }
  await intact(view, baseline);
});

for (const platform of ["macos", "windows"]) {
  test(`settings floating surface ${platform} fills the available width without empty Provider tracks`, { timeout: 90_000 }, async t => {
    const { view, baseline } = await uiFixture(t, { nativeExtension: `Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ${JSON.stringify(platform === "macos" ? "Macintosh" : "Windows NT 10.0")} });` });
    const geometry = [];
    for (const mode of ["dark", "light"]) {
      if (await view.cdp.evaluate("!!document.querySelector('.settings-view')")) await click(view, 'button[title="关闭设置"]');
      await theme(view, mode);
      for (const [width, height] of [[1440, 960], [720, 480], [640, 720]]) {
        await resize(view, width, height);
        for (const [section, label] of [["appearance", "外观"], ["provider", "全局 Provider"]]) {
          await settings(view, label);
          await waitFor(view, section === "provider" ? "!!document.querySelector('.provider-card')" : "!!document.querySelector('.appearance')");
          const layout = await view.cdp.evaluate(`(() => {
            const content = document.querySelector('.settings-content'), nav = document.querySelector('.settings-nav');
            const r = content.getBoundingClientRect(), n = nav.getBoundingClientRect(), s = getComputedStyle(content), root = getComputedStyle(document.documentElement);
            const list = document.querySelector('.provider-list'), card = list?.querySelector('.provider-card');
            return { x: r.x, y: r.y, right: innerWidth-r.right, bottom: innerHeight-r.bottom, navWidth: n.width, navBottom: n.bottom,
              radius: s.borderRadius, shadow: s.boxShadow, inset: parseFloat(root.getPropertyValue('--content-inset')),
              titlebar: parseFloat(root.getPropertyValue('--titlebar-inset')), background: getComputedStyle(document.querySelector('.settings-view')).backgroundColor,
              navBackground: getComputedStyle(nav).backgroundColor, padding: s.paddingLeft,
              available: content.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
              page: content.firstElementChild.getBoundingClientRect().width,
              overflow: content.scrollWidth > content.clientWidth+1 || document.documentElement.scrollWidth > innerWidth,
              list: list?.getBoundingClientRect().width, card: card?.getBoundingClientRect().width,
              columns: list ? getComputedStyle(list).gridTemplateColumns.split(' ').length : null };
          })()`);
          assert.equal(layout.radius, "12px");
          assert.notEqual(layout.shadow, "none");
          assert.equal(layout.right, 8); assert.equal(layout.bottom, 8);
          assert.equal(layout.background, layout.navBackground, "rail joins the window background without a color seam");
          assert.equal(layout.overflow, false);
          assert.ok(Math.abs(layout.page-layout.available) <= 1, "settings page fills the content surface");
          if (width === 640) {
            assert.equal(layout.x, 8);
            assert.ok(layout.y >= layout.navBottom, "narrow layout stacks navigation above content");
          } else {
            assert.equal(layout.navWidth, width === 1440 ? 240 : 196);
            assert.equal(layout.y, platform === "windows" ? layout.titlebar+8 : Math.max(8, layout.titlebar-20));
          }
          if (width === 1440) {
            assert.equal(layout.padding, "32px");
          }
          if (section === "provider" && width === 1440) {
            assert.ok(Math.abs(layout.card-layout.list) <= 1, "single card fills the row without empty tracks");
          }
          await view.cdp.evaluate("document.querySelector('.settings-content').scrollTop=0");
          await capture(view, `${platform}-${section}-${mode}-${width}x${height}`);
          geometry.push({ mode, section, width, height, ...layout });
        }
      }
    }
    await intact(view, baseline);
    if (OUT) await writeFile(join(OUT, `${platform}-geometry.json`), JSON.stringify(geometry, null, 2));
  });
}
