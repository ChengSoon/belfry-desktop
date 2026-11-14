import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, press, waitFor, fill, setValue, resize, intact, evidence, theme, settings, menuAction, clickOption, imeEnter } from "./production-uiFixture.mjs";

const SETTINGS_CLOSE = 'button[title="关闭设置"]';
/** 模型服务默认是配线台；原来的服务编辑器（卡片、表单、未保存保护）在「管理服务」里。 */
async function providerEditor(view) {
  await settings(view, "模型服务");
  await waitFor(view, "!!document.querySelector('.model-routing, .provider-section')");
  if (await view.cdp.evaluate("!!document.querySelector('.model-routing')")) await clickText(view, "管理服务", '.model-routing__bar');
  await waitFor(view, "!!document.querySelector('.provider-section')");
}
const SESSION_A = '.session-row__main[aria-label^="Alpha"]';
const SESSION_B = '.session-row__main[aria-label^="Beta"]';
const PROVIDER_AGENTS = [["claude", "Claude Code"], ["codex", "Codex"], ["pi", "Pi"],
  ["antigravity", "Antigravity CLI"], ["opencode", "OpenCode"], ["kimi", "Kimi Code"]];
const SAVED_TYPOGRAPHY = { fontFamily: "JetBrains Mono", fontSize: 17, activeImportedFont: null, importedFonts: [] };
const SAVED_WALLPAPER = { fileName: "synthetic-wallpaper.png", mime: "image/png", fit: "cover", opacity: 1,
  blur: 0, veil: { dark: 0.61, light: 0.87 }, videoPaused: false };

for (const platform of ["macos", "windows"]) {
  test(`production UI ${platform} Obsidian preserves wallpaper and typography through compact menus and collapse`, { timeout: 90_000 }, async t => {
    const nativeExtension = `(() => {
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ${JSON.stringify(platform === "macos" ? "Macintosh" : "Windows NT 10.0")} });
      localStorage.setItem('belfry.typography.v1', ${JSON.stringify(JSON.stringify(SAVED_TYPOGRAPHY))});
      localStorage.setItem('belfry.background.v1', ${JSON.stringify(JSON.stringify(SAVED_WALLPAPER))});
      const recent = JSON.parse(localStorage.getItem('belfry.recent-projects.v1'))[0];
      localStorage.setItem('belfry.recent-projects.v1', JSON.stringify([recent, ...Array.from({length: 20}, (_, index) => ({
        ...recent, id: 'synthetic-recent-' + index, rootPath: '/qa/recent-project-' + index,
        name: 'Synthetic long recent project ' + index, rootUri: 'file:///qa/recent-project-' + index
      }))]));
      const image = document.createElement('canvas'); image.width = image.height = 8;
      const ctx = image.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 8, 8);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 4, 8);
      const bytes = Uint8Array.from(atob(image.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (command, args = {}) => {
        if (command === 'background_read') { __productionQA.calls.push({command, args}); return Promise.resolve(bytes.buffer); }
        return original(command, args);
      };
    })();`;
    const { view, baseline } = await uiFixture(t, { nativeExtension });
    await waitFor(view, "document.documentElement.dataset.background === 'on'");
    await view.cdp.evaluate(`(async () => {
      const image = new Image(); image.src = document.documentElement.style.getPropertyValue('--app-bg-image').match(/url\\("([^"]+)"\\)/)[1];
      await image.decode();
    })()`);
    for (const mode of ["dark", "light"]) {
      await theme(view, mode);
      for (const [width, height] of [[1440, 960], [720, 480]]) {
        await resize(view, width, height);
        await evidence(view, `${platform}-wallpaper-${mode}-${width}x${height}`, ['button[aria-label="Quick Open"]',
          ...(platform === "windows" ? ['.window-controls button:first-child', '.window-control-close'] : [])]);
        const surfaces = await view.cdp.evaluate(`(() => {
          const root = document.documentElement, workbench = document.querySelector('.workbench'), r = workbench.getBoundingClientRect();
          const paint = selector => { const ctx = document.createElement('canvas').getContext('2d');
            ctx.fillStyle = getComputedStyle(document.querySelector(selector)).backgroundColor; ctx.fillRect(0, 0, 1, 1);
            return [...ctx.getImageData(0, 0, 1, 1).data]; };
          return { platform: root.dataset.platform, right: innerWidth - r.right, bottom: innerHeight - r.bottom, top: r.top,
            canvas: getComputedStyle(workbench).backgroundColor, shadow: getComputedStyle(workbench).boxShadow,
            sidebar: paint('.sidebar'), body: paint('.terminal-pane.is-onstage .terminal-pane__body'),
            active: paint('.session-row.is-active'), fontSize: root.style.getPropertyValue('--app-font-size'),
            font: getComputedStyle(document.body).fontFamily, image: getComputedStyle(document.querySelector('.app-background'), '::before').backgroundImage };
        })()`);
        assert.equal(surfaces.platform, platform);
        assert.deepEqual([surfaces.right, surfaces.bottom, surfaces.top], [8, 8, platform === "macos" ? 8 : 48]);
        assert.equal(surfaces.canvas, "rgba(0, 0, 0, 0)", "the new content surface must let the wallpaper through");
        assert.notEqual(surfaces.shadow, "none");
        assert.ok(Math.abs(surfaces.sidebar[3] - Math.round(255 * (mode === "dark" ? .9 : .94))) <= 1);
        assert.ok(Math.abs(surfaces.body[3] - Math.round(255 * SAVED_WALLPAPER.veil[mode])) <= 1, "terminal retains the user's per-theme veil");
        assert.equal(surfaces.active[3], 255, "current session remains opaque on contrasting wallpapers");
        assert.equal(surfaces.fontSize, "17px");
        assert.ok(surfaces.font.includes('"JetBrains Mono"'));
        assert.ok(surfaces.image.includes("blob:"));
        await click(view, '.project-trigger');
        await waitFor(view, "!!document.querySelector('.popover--project')");
        await view.cdp.evaluate("document.querySelector('.popover--project').scrollTop = document.querySelector('.popover--project').scrollHeight");
        await evidence(view, `${platform}-project-popup-${mode}-${width}x${height}`, ['.project-picker-actions button:last-child']);
        assert.ok(await view.cdp.evaluate(`(() => {
          const a = document.querySelector('.popover--project').getBoundingClientRect(), b = document.querySelector('.workbench').getBoundingClientRect();
          return a.left >= b.left && a.right <= b.right && a.bottom <= b.bottom;
        })()`), "project popup fits inside the rounded content surface");
        await clickText(view, '项目设置', '.popover--project');
        await waitFor(view, "!!document.querySelector('.project-library')");
        await press(view, "Escape");
        await click(view, 'button[title="更多工具"]');
        await waitFor(view, "!!document.querySelector('.workbench-menu')");
        await view.cdp.evaluate("document.querySelector('.workbench-menu').scrollTop = document.querySelector('.workbench-menu').scrollHeight");
        await evidence(view, `${platform}-tools-popup-${mode}-${width}x${height}`, ['.workbench-menu > button:last-child']);
        await press(view, "Escape");
        await click(view, '.sidebar-context__collapse');
        await waitFor(view, "document.querySelector('.app-shell').classList.contains('is-collapsed')");
        await evidence(view, `${platform}-collapsed-${mode}-${width}x${height}`, ['.workbench-toolbar > button:first-child']);
        assert.equal(await view.cdp.evaluate("document.querySelector('.workbench').getBoundingClientRect().left"), 8);
        await click(view, '.workbench-toolbar > button:first-child');
        await waitFor(view, "!document.querySelector('.app-shell').classList.contains('is-collapsed')");
        await intact(view, baseline);
      }
      await settings(view, "外观");
      await evidence(view, `${platform}-wallpaper-settings-${mode}`, [SETTINGS_CLOSE]);
      await click(view, SETTINGS_CLOSE);
      await waitFor(view, "!document.querySelector('.settings-view')");
    }
    assert.deepEqual(await view.cdp.evaluate(`({ font: JSON.parse(localStorage.getItem('belfry.typography.v1')),
      wallpaper: JSON.parse(localStorage.getItem('belfry.background.v1')) })`), { font: SAVED_TYPOGRAPHY, wallpaper: SAVED_WALLPAPER });
    await intact(view, baseline);
  });
}

test("production UI workbench themes, session selection, real drag split and Quick Open keyboard", { timeout: 90_000 }, async t => {
  const { view, baseline, requests } = await uiFixture(t);
  assert.ok(requests.some(request => /\/assets\/index-.*\.js/.test(request.url)));
  assert.ok(!requests.some(request => /docs\/design|@vite|src\/App/.test(request.url)), "only production assets are served");
  for (const mode of ["dark", "light"]) {
    await theme(view, mode);
    const appearance = await view.cdp.evaluate(`({
      canvas: getComputedStyle(document.documentElement).getPropertyValue('--backdrop').trim()
        .replace(/^#([\\da-f])([\\da-f])([\\da-f])$/i, '#$1$1$2$2$3$3'),
      meta: document.querySelector('meta[name="theme-color"]').content
    })`);
    assert.equal(appearance.meta, appearance.canvas, `${mode}: runtime theme metadata matches the painted window backdrop`);
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768], [720, 480]]) {
      await resize(view, width, height);
      await evidence(view, `workbench-${mode}-${width}x${height}`, ['button[aria-label="Quick Open"]', 'button[title^="设置"]']);
      assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar')).backgroundColor"),
        mode === "dark" ? "rgb(12, 13, 16)" : "rgb(236, 236, 239)", "Production sidebar uses the settled Obsidian theme");
      const plane = await view.cdp.evaluate(`(() => {
        const el = document.querySelector('.workbench'), r = el.getBoundingClientRect(), css = getComputedStyle(el);
        return { right: innerWidth - r.right, bottom: innerHeight - r.bottom, radius: css.borderTopRightRadius,
          background: css.backgroundColor, border: getComputedStyle(document.querySelector('.sidebar')).borderRightWidth };
      })()`);
      assert.deepEqual(plane, { right: 8, bottom: 8, radius: "12px", background: mode === "dark" ? "rgb(19, 20, 24)" : "rgb(255, 255, 255)", border: "0px" });
      await intact(view, baseline);
    }
    await click(view, SESSION_B);
    const selection = await view.cdp.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(SESSION_B)}), row = el.closest('.session-row'), css = getComputedStyle(row, '::before');
      return { selected: el.getAttribute('aria-current'), width: css.width, height: parseFloat(css.height),
        rowHeight: row.getBoundingClientRect().height, color: css.backgroundColor, weight: getComputedStyle(el).fontWeight };
    })()`);
    assert.equal(selection.selected, "true");
    assert.equal(selection.width, "2px");
    // 两行会话（44px）的竖条上下各留 10px，见 workspace/obsidianWorkbench.css。
    assert.equal(selection.height, selection.rowHeight - 20);
    assert.equal(selection.color, mode === "dark" ? "rgb(139, 147, 255)" : "rgb(72, 78, 212)");
    assert.equal(selection.weight, "500");
    await click(view, SESSION_A);
  }
  await resize(view, 1440, 960);
  await click(view, SESSION_B);
  await waitFor(view, `document.querySelector(${JSON.stringify(SESSION_B)}).getAttribute('aria-current') === 'true'`);
  await click(view, SESSION_A);
  const points = await view.cdp.evaluate(`(() => {
    const a = document.querySelector(${JSON.stringify(SESSION_B)}).getBoundingClientRect();
    const b = document.querySelector('.terminal-pane.is-onstage').getBoundingClientRect();
    return {from:{x:a.x+a.width/2,y:a.y+a.height/2},to:{x:b.right-30,y:b.y+b.height/2}};
  })()`);
  await view.send("Input.dispatchMouseEvent", { type: "mousePressed", ...points.from, button: "left", clickCount: 1 });
  for (let step = 1; step <= 8; step++) await view.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: points.from.x + (points.to.x - points.from.x) * step / 8, y: points.from.y + (points.to.y - points.from.y) * step / 8, buttons: 1 });
  await waitFor(view, "!!document.querySelector('.drop-indicator--right') && document.body.classList.contains('is-dragging-session')");
  await view.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...points.to, button: "left", clickCount: 1 });
  await waitFor(view, "document.querySelectorAll('.terminal-pane.is-onstage.is-split').length === 2");
  await evidence(view, "session-drag-split");
  await intact(view, baseline);
  await click(view, 'button[aria-label="Quick Open"]');
  await waitFor(view, "document.activeElement?.getAttribute('role') === 'combobox'");
  await fill(view, '.quick-open input', "Beta");
  await press(view, "ArrowDown"); await press(view, "Home");
  await evidence(view, "quick-open-keyboard");
  await press(view, "Enter");
  await waitFor(view, "!document.querySelector('.quick-open')");
  await waitFor(view, `document.querySelector(${JSON.stringify(SESSION_B)}).getAttribute('aria-current') === 'true'`);
  await click(view, 'button[aria-label="Quick Open"]');
  await press(view, "Escape");
  await waitFor(view, "document.activeElement?.getAttribute('aria-label') === 'Quick Open'");
  await intact(view, baseline);
});

test("production UI all settings categories in both themes and compact layout", { timeout: 120_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  const sections = ["外观", "快捷键", "模型服务", "会话状态", "插件", "数据与备份", "协作环境", "关于"];
  for (const mode of ["dark", "light"]) {
    await theme(view, mode);
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768]]) {
      await resize(view, width, height);
      await settings(view);
      for (const label of sections) {
        await settings(view, label);
        await waitFor(view, "!!document.querySelector('.settings-content > *')");
        await evidence(view, `settings-${label}-${mode}-${width}x${height}`, [SETTINGS_CLOSE]);
        assert.ok(await view.cdp.evaluate("document.querySelector('.settings-content').textContent.trim().length > 0"));
        await intact(view, baseline);
      }
      await click(view, SETTINGS_CLOSE);
      await waitFor(view, "!document.querySelector('.settings-view')");
    }
  }
});

test("production UI Provider preserves original cards, segment slider and selection motion", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await providerEditor(view);
  await waitFor(view, "!!document.querySelector('.provider-card')");
  assert.equal(await view.cdp.evaluate("document.querySelector('.provider-list').style.getPropertyValue('--provider-columns')"), "1");
  // Synthetic catalogue setup only; refresh through the public UI, not React internals.
  await view.cdp.evaluate(`(() => {
    const group = __productionQA.catalog.agents.find(group => group.kind === 'claude');
    for (let i = 2; i <= 3; i++) group.providers.push({...group.providers[0], id:'synthetic-' + i, name:'Synthetic service ' + i});
    const animate = Element.prototype.animate;
    __productionQA.cardAnimations = [];
    Element.prototype.animate = function(frames, options) {
      if (this.matches('.provider-card')) __productionQA.cardAnimations.push(frames);
      return animate.call(this, frames, options);
    };
  })()`);
  await click(view, 'button[aria-label="重新读取 Provider 列表"]');
  await waitFor(view, "document.querySelectorAll('.provider-card').length === 3");
  for (const mode of ["dark", "light"]) {
    await click(view, SETTINGS_CLOSE);
    await theme(view, mode);
    await providerEditor(view);
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768]]) {
      await resize(view, width, height);
      await evidence(view, `provider-original-cards-${mode}-${width}x${height}`, [SETTINGS_CLOSE,
        ...PROVIDER_AGENTS.map((_, index) => `.provider-segments button:nth-child(${index + 1})`)]);
      const layout = await view.cdp.evaluate(`(() => {
        const list = document.querySelector('.provider-list'), card = list.querySelector('.provider-card');
        const css = getComputedStyle(card);
        return { count:list.style.getPropertyValue('--provider-columns'), columns:getComputedStyle(list).gridTemplateColumns.split(' ').length,
          cardColumns:css.gridTemplateColumns.split(' ').length, radius:css.borderRadius, border:css.borderTopWidth,
          segments:getComputedStyle(document.querySelector('.provider-segments')).display,
          scopeBadges:document.querySelectorAll('.provider-scope-note, .provider-card__scope').length };
      })()`);
      assert.equal(layout.count, "3");
      assert.ok(layout.columns >= 1 && layout.columns <= 3);
      if (width === 1440) assert.equal(layout.columns, 3);
      assert.deepEqual({ ...layout, columns: 0 }, { count:"3", columns:0, cardColumns:1, radius:"12px", border:"1px", segments:"grid", scopeBadges:0 });
    }
  }
  await resize(view, 1440, 960);
  await view.send("Emulation.setEmulatedMedia", { features: [{ name:"prefers-reduced-motion", value:"no-preference" }] });
  await click(view, '.provider-card .provider-card__activate');
  await waitFor(view, "!!document.querySelector('.provider-card.is-active')");
  assert.ok(await view.cdp.evaluate("__productionQA.cardAnimations.some(frames => frames.some(frame => frame.transform.includes('rotateY(90deg)')))"));
  await clickText(view, "切回官方", '.provider-official');
  await waitFor(view, "!document.querySelector('.provider-card.is-active')");
  await view.send("Emulation.setEmulatedMedia", { features: [{ name:"prefers-reduced-motion", value:"reduce" }] });
  await view.cdp.evaluate("__productionQA.cardAnimations.length = 0");
  await click(view, '.provider-card .provider-card__activate');
  await waitFor(view, "!!document.querySelector('.provider-card.is-active')");
  assert.equal(await view.cdp.evaluate("__productionQA.cardAnimations.length"), 0);
  await clickText(view, "Codex", '.provider-segments');
  await waitFor(view, "document.querySelector('.provider-segments').dataset.active === 'codex'");
  assert.notEqual(await view.cdp.evaluate("getComputedStyle(document.querySelector('.provider-segments'), '::before').transform"), "matrix(1, 0, 0, 1, 0, 0)");
  for (const width of [1440, 820]) {
    await resize(view, width, 960);
    for (const [kind, label] of PROVIDER_AGENTS) {
      await clickText(view, label, '.provider-segments');
      await waitFor(view, `document.querySelector('.provider-segments').dataset.active === ${JSON.stringify(kind)}`);
      assert.ok(await view.cdp.evaluate(`document.querySelector('.provider-card h4').textContent.includes(${JSON.stringify(label)})`));
      const geometry = await view.cdp.evaluate(`(() => {
        const segments = document.querySelector('.provider-segments'), active = segments.querySelector('[aria-selected="true"]');
        const css = getComputedStyle(segments, '::before'), position = new DOMMatrix(css.transform);
        return { x: position.m41 - active.offsetLeft, y: position.m42 - active.offsetTop,
          width: parseFloat(css.width) - active.offsetWidth, height: parseFloat(css.height) - active.offsetHeight };
      })()`);
      assert.ok(Object.values(geometry).every(delta => Math.abs(delta) <= 1), `${kind} selection must follow its tab after wrapping: ${JSON.stringify(geometry)}`);
    }
  }
  await intact(view, baseline);
});

test("production UI new native agents launch, filter and resume their own sessions", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  let extraCreates = 0;
  for (const [kind, label] of PROVIDER_AGENTS.slice(3)) {
    await click(view, 'button[title^="新建会话"]');
    await clickText(view, label, '[role="menu"][aria-label="新建会话"]');
    await waitFor(view, `__productionQA.creates === ${baseline.creates + ++extraCreates}`);
    assert.ok(await view.cdp.evaluate(`__productionQA.calls.some(call => call.command === 'terminal_create' && call.args.request.profileId === ${JSON.stringify(`agent:${kind}`)} && !call.args.request.resume)`));
    await click(view, 'button[title^="历史会话"]');
    await clickText(view, label, '.history-segments');
    await waitFor(view, `document.querySelector('.history-item__meta')?.textContent.includes(${JSON.stringify(label)})`);
    assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'history_search').at(-1).args.request.query.agent"), kind);
    await evidence(view, `native-agent-history-${kind}`, ['input[aria-label="搜索历史正文"]', 'button[aria-label="继续会话"]']);
    await click(view, 'button[aria-label="继续会话"]');
    await waitFor(view, `__productionQA.creates === ${baseline.creates + ++extraCreates}`);
    assert.ok(await view.cdp.evaluate(`__productionQA.calls.some(call => call.command === 'terminal_create' && call.args.request.profileId === ${JSON.stringify(`agent:${kind}`)} && call.args.request.resume === ${JSON.stringify(`synthetic-history-${kind}`)})`));
    if (await view.cdp.evaluate("!!document.querySelector('.history-panel')")) {
      await click(view, 'button[title="关闭历史会话"]');
      await waitFor(view, "!document.querySelector('.history-panel')");
    }
    await intact(view, baseline, extraCreates);
  }
});

test("production UI Provider keep replace clear, explicit raw consent and search preserves guarded editor", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await providerEditor(view);
  await waitFor(view, "!!document.querySelector('.provider-card')");
  for (const action of ["keep", "replace", "clear"]) {
    await click(view, '.provider-card button[aria-label^="编辑 "]');
    await waitFor(view, "!!document.querySelector('#provider-apiKey')");
    assert.equal(await view.cdp.evaluate("document.querySelector('#provider-apiKey').value"), "");
    assert.equal(await view.cdp.evaluate("document.querySelector('#provider-apiKeyAction').value"), "keep");
    await setValue(view, '#provider-apiKeyAction', action);
    if (action === "replace") await fill(view, '#provider-apiKey', 'synthetic-replacement-not-a-real-key');
    assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /provider_config_preview/.test(call.command)).length"), 0);
    await clickText(view, "保存配置", '.provider-form');
    await waitFor(view, "!document.querySelector('.provider-form')");
    const saved = await view.cdp.evaluate("__productionQA.savedProviders.at(-1).draft");
    assert.equal(saved.apiKeyAction, action);
    assert.equal(saved.apiKey, action === "replace" ? "synthetic-replacement-not-a-real-key" : "");
    await evidence(view, `provider-${action}`);
  }
  await click(view, '.provider-card button[aria-label^="编辑 "]');
  await fill(view, '#provider-name', 'Synthetic unsaved provider draft');
  await waitFor(view, `document.querySelector(${JSON.stringify(SETTINGS_CLOSE)}).disabled`);
  await fill(view, 'input[aria-label="搜索设置分类"]', 'no-such-category');
  await waitFor(view, "!!document.querySelector('.settings-nav__empty')");
  assert.equal(await view.cdp.evaluate("document.querySelector('#provider-name').value"), 'Synthetic unsaved provider draft');
  await press(view, "Escape");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.provider-form') && !!document.querySelector('.settings-view')"), true);
  await fill(view, 'input[aria-label="搜索设置分类"]', '');
  await click(view, '.provider-advanced summary');
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /provider_config_preview/.test(call.command)).length"), 0, "opening advanced disclosure is not consent");
  await clickText(view, "查看含密钥的原始配置", '.provider-config');
  await waitFor(view, "!!document.querySelector('.provider-config__editor')");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => /provider_config_preview/.test(call.command)).length"), 1);
  assert.ok(await view.cdp.evaluate("document.querySelector('.provider-config__editor').value.includes('synthetic-test-secret-not-a-real-key')"));
  assert.ok(await view.cdp.evaluate("__productionQA.calls.filter(call => /provider_config_preview/.test(call.command)).every(call => call.args.revealSecrets === true)"));
  await setValue(view, '.provider-config__editor', '{"synthetic":true,"unsaved":true}');
  await clickText(view, "保存配置", '.provider-form');
  await waitFor(view, "document.querySelector('.provider-notice')?.textContent.includes('未保存')");
  assert.equal(await view.cdp.evaluate("__productionQA.savedProviders.length"), 3);
  await evidence(view, "provider-sensitive-unsaved-guard");
  await clickText(view, "还原", '.provider-config');
  await clickText(view, "取消", '.provider-form');
  await click(view, SETTINGS_CLOSE);
  await intact(view, baseline);
});

test("production UI projects, named workspace, SSH and generic confirmation focus return", { timeout: 60_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await click(view, '.project-trigger');
  await clickText(view, '项目设置', '.popover--project');
  await waitFor(view, "!!document.querySelector('.project-library')");
  await evidence(view, 'projects-dialog', ['button[aria-label="关闭项目设置"]']);
  await press(view, 'Escape');
  await waitFor(view, "document.activeElement?.classList.contains('project-trigger')");
  await click(view, 'button[title^="新建会话"]');
  await clickText(view, 'SSH', '[role="menu"]');
  await waitFor(view, "!!document.querySelector('.modal--ssh')");
  await evidence(view, 'ssh-dialog', ['button[aria-label="关闭 SSH 连接弹框"]']);
  await press(view, 'Escape');
  await waitFor(view, "document.activeElement?.title.startsWith('新建会话')");
  await click(view, '.project-trigger');
  await click(view, '.popover-list__delete');
  await waitFor(view, "!!document.querySelector('.modal__danger')");
  assert.equal(await view.cdp.evaluate("document.activeElement.textContent.trim()"), '取消');
  await press(view, 'Tab');
  assert.equal(await view.cdp.evaluate("document.activeElement.classList.contains('modal__danger')"), true);
  await evidence(view, 'generic-confirmation');
  await press(view, 'Escape');
  await waitFor(view, "document.activeElement?.classList.contains('popover-list__delete')");
  await press(view, 'Escape');
  await waitFor(view, "!document.querySelector('.popover--project')");
  await click(view, '.named-workspaces__trigger');
  await evidence(view, 'named-workspaces');
  await clickText(view, '重命名', '.named-workspaces__popover');
  await waitFor(view, "!!document.querySelector('.named-workspaces__popover input')");
  await fill(view, '.named-workspaces__popover input', 'Synthetic long named workspace');
  // 输入法选词回车（事后 229 形状）不得触发表单隐式保存：编辑框与表单原地保留。
  await imeEnter(view, '.named-workspaces__popover input');
  assert.equal(await view.cdp.evaluate("document.querySelector('.named-workspaces__popover input')?.value"), 'Synthetic long named workspace', "选词回车后表单未被隐式提交");
  await clickText(view, '保存', '.named-workspaces__popover');
  await waitFor(view, "document.querySelector('.named-workspaces__trigger')?.textContent.includes('Synthetic long')");
  await press(view, 'Escape');
  await waitFor(view, "!document.querySelector('.named-workspaces__popover')");
  await evidence(view, 'named-workspaces-long-name', ['button[title^="新建会话"]']);
  await click(view, 'button[title^="新建会话"]');
  await waitFor(view, "!!document.querySelector('[role=menu][aria-label=新建会话]')");
  await press(view, 'Escape');
  await intact(view, baseline);
});

test("production UI collaboration waiting result, inspector tree diff, history search resume and usage", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'collab_tasks')");
  await menuAction(view, '会话协作', 'button[title="会话协作"]');
  await waitFor(view, "document.querySelector('.collab-panel')?.textContent.includes('等你确认')");
  await click(view, '.collab-event__result-detail summary');
  await waitFor(view, "document.querySelector('.collab-event__result-detail[open]')?.textContent.includes('Synthetic result')");
  await evidence(view, 'collaboration-waiting-result', ['button[aria-label="关闭协作面板"]']);
  await clickText(view, '批准', '.collab-panel');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'collab_approve')");
  await click(view, 'button[aria-label="关闭协作面板"]');
  await click(view, 'button[aria-label="文件预览"]');
  await waitFor(view, "!!document.querySelector('.file-preview__entry')");
  await click(view, '.file-preview__entry');
  await waitFor(view, "document.querySelector('.file-preview__content')?.textContent.includes('syntheticGraphite')");
  await evidence(view, 'inspector-file-tree', ['button[title="关闭文件预览"]']);
  await click(view, 'button[aria-label="查看 Git 变更"]');
  await waitFor(view, "!!document.querySelector('.git-file__select')");
  await click(view, '.git-file__select');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'git_diff')");
  await evidence(view, 'inspector-git-diff', ['button[aria-label="关闭 Git 面板"]']);
  await click(view, 'button[aria-label="关闭 Git 面板"]');
  await click(view, 'button[title^="历史会话"]');
  await waitFor(view, "!!document.querySelector('.history-item')");
  await fill(view, 'input[aria-label="搜索历史正文"]', 'Graphite');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'history_search' && call.args.request.query.text === 'Graphite')");
  await evidence(view, 'history-search-resume');
  await click(view, 'button[aria-label="继续会话"]');
  await waitFor(view, `__productionQA.creates === ${baseline.creates + 1}`);
  assert.ok(await view.cdp.evaluate("__productionQA.calls.some(call => call.command === 'terminal_create' && call.args.request.resume === 'synthetic-history' && call.args.request.profileId === 'agent:claude')"));
  await intact(view, baseline, 1);
  await click(view, 'button[title^="额度用量"]');
  await waitFor(view, "!!document.querySelector('.usage-head') && document.querySelector('.usage-body')?.getAttribute('aria-busy') === 'false'");
  await evidence(view, 'usage', ['button[aria-label="关闭用量"]']);
  await click(view, 'button[aria-label="刷新用量"]');
  await click(view, 'button[aria-label="关闭用量"]');
  await intact(view, baseline, 1);
});

test("production UI plugin installed permissions, marketplace detail and explicit source settings", { timeout: 60_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await theme(view, "light");
  await settings(view, '插件');
  await waitFor(view, "!!document.querySelector('.plugins-row-details-toggle')");
  await waitFor(view, "!!document.querySelector('.plugins-search')");
  await evidence(view, 'plugins-search-light');
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.plugins-search')).backgroundColor"),
    await view.cdp.evaluate("getComputedStyle(document.querySelector('.settings-search')).backgroundColor"),
    "light plugin search uses the shared field surface");
  await click(view, '.plugins-search');
  await waitFor(view, "document.querySelector('.plugins-search').matches(':focus-visible')");
  await evidence(view, 'plugins-search-light-focus');
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.plugins-search')).backgroundColor"),
    // 设置是弹窗（T41）：内容区透明，可见的画布是弹窗本身。
    await view.cdp.evaluate("getComputedStyle(document.querySelector('.settings-view')).backgroundColor"),
    "focused plugin search uses the shared canvas");
  await click(view, '.plugins-row-details-toggle');
  await waitFor(view, "!!document.querySelector('.plugins-row-details-body')");
  await evidence(view, 'plugins-installed-permissions');
  await click(view, '#plugins-tab-market');
  await waitFor(view, "!!document.querySelector('.plugins-card-hit')");
  await evidence(view, 'plugins-market-source');
  await click(view, 'button[aria-label="插件市场来源"]');
  await clickOption(view, '自有在线市场');
  await waitFor(view, "!!document.querySelector('input[aria-label=\"目录地址\"]')");
  await fill(view, 'input[aria-label="目录地址"]', 'https://synthetic.invalid/catalog.json');
  await clickText(view, '保存并连接', '.plugins-market-settings');
  await waitFor(view, "__productionQA.calls.some(call => call.args?.method === 'management.source' && call.args.params.settings.pluginMarketCustomUrl.includes('synthetic.invalid'))");
  await click(view, '.plugins-card-hit');
  await waitFor(view, "document.querySelector('.plugins-sheet[role=dialog]')?.textContent.includes('Synthetic')");
  await evidence(view, 'plugins-market-detail');
  await intact(view, baseline);
});

test("production UI satellite panels remain reachable in both themes at desktop and narrow sizes", { timeout: 120_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  for (const mode of ["dark", "light"]) {
    await resize(view, 1440, 960);
    await theme(view, mode);
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768]]) {
      await resize(view, width, height);
      const stamp = `${mode}-${width}x${height}`;
      await menuAction(view, "会话协作", 'button[title="会话协作"]');
      await waitFor(view, "!!document.querySelector('.collab-panel')");
      await evidence(view, `collab-${stamp}`, ['button[aria-label="关闭协作面板"]']);
      await click(view, 'button[aria-label="关闭协作面板"]');
      await click(view, 'button[aria-label="文件预览"]');
      await waitFor(view, "!!document.querySelector('.file-preview__entry')");
      await evidence(view, `files-${stamp}`, ['button[title="关闭文件预览"]']);
      await click(view, 'button[aria-label="查看 Git 变更"]');
      await waitFor(view, "!!document.querySelector('.git-file__select')");
      await evidence(view, `git-${stamp}`, ['button[aria-label="关闭 Git 面板"]']);
      await click(view, 'button[aria-label="关闭 Git 面板"]');
      await click(view, 'button[title^="历史会话"]');
      await waitFor(view, "!!document.querySelector('.history-item')");
      await evidence(view, `history-${stamp}`, ['input[aria-label="搜索历史正文"]',
        ...Array.from({ length: 7 }, (_, index) => `.history-segments button:nth-child(${index + 1})`)]);
      await press(view, 'Escape');
      await click(view, 'button[title^="额度用量"]');
      await waitFor(view, "!!document.querySelector('.usage-head') && document.querySelector('.usage-body')?.getAttribute('aria-busy') === 'false'");
      await evidence(view, `usage-${stamp}`, ['button[aria-label="关闭用量"]', 'button[aria-label="刷新用量"]']);
      await click(view, 'button[aria-label="关闭用量"]');
      await click(view, '.project-trigger');
      await clickText(view, '项目设置', '.popover--project');
      await waitFor(view, "!!document.querySelector('.project-library')");
      await evidence(view, `projects-${stamp}`, ['button[aria-label="关闭项目设置"]']);
      await press(view, 'Escape');
      await click(view, 'button[title^="新建会话"]');
      await clickText(view, 'SSH', '[role="menu"]');
      await waitFor(view, "!!document.querySelector('.modal--ssh')");
      await evidence(view, `ssh-${stamp}`, ['button[aria-label="关闭 SSH 连接弹框"]']);
      await press(view, 'Escape');
      await intact(view, baseline);
    }
  }
});

test("production UI model routing patch bay rewires global and project routes through the provider IPC", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await resize(view, 1440, 960);
  await settings(view, "模型服务");
  await waitFor(view, "document.querySelectorAll('.patch-bay__wire').length === 6");
  assert.equal(await view.cdp.evaluate("document.querySelector('.settings-crumb strong').textContent"), "模型服务");
  // 选中 Claude Code：其余 Agent 变暗，只有它保存过的服务是可接的虚线插孔。
  await click(view, '.patch-bay__agents .patch-jack:nth-of-type(1)');
  await waitFor(view, "document.querySelectorAll('.patch-bay__agents .patch-jack.is-dim').length === 5");
  assert.ok(await view.cdp.evaluate("document.querySelectorAll('.patch-bay__services .patch-jack.is-target').length >= 1"));
  await click(view, '.patch-bay__services .patch-jack.is-target');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'provider_switch' && call.args.kind === 'claude' && call.args.id)");
  await waitFor(view, "!document.querySelector('.patch-jack.is-picked')");
  await waitFor(view, "[...document.querySelectorAll('.patch-bay__services .patch-jack__count')].slice(1).some(e => e.textContent === '1')");
  // 接到自定义服务后线仍然画出来：线数 = 已接线的 Agent 数，且有一根落在非「官方」插孔上。
  await waitFor(view, "document.querySelectorAll('.patch-bay__wire').length === 6");
  assert.ok(await view.cdp.evaluate(`(() => {
    const ports = [...document.querySelectorAll('.patch-bay__services [data-service-port]')].map(e => e.getBoundingClientRect());
    const bay = document.querySelector('.patch-bay').getBoundingClientRect();
    const ends = [...document.querySelectorAll('.patch-bay__wire')].map(p => p.getPointAtLength(p.getTotalLength()));
    return ends.some(pt => ports.slice(1).some(r => Math.abs(r.top + r.height / 2 - bay.top - pt.y) < 2));
  })()`), "a wire reaches a custom service jack");
  // Esc 只取消选中，不关闭设置。
  await click(view, '.patch-bay__agents .patch-jack:nth-of-type(2)');
  await waitFor(view, "!!document.querySelector('.patch-jack.is-picked')");
  await view.cdp.evaluate("document.querySelector('.patch-jack.is-picked').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
  await waitFor(view, "!document.querySelector('.patch-jack.is-picked')");
  assert.ok(await view.cdp.evaluate("!!document.querySelector('.settings-view')"));
  // 项目作用域：接到「跟随全局」以外的服务 = project_provider_select。
  await clickText(view, "项目", '.model-routing__scope');
  await waitFor(view, "!!document.querySelector('.patch-bay') && document.querySelector('.patch-bay__services .patch-jack b').textContent === '跟随全局'");
  await click(view, '.patch-bay__agents .patch-jack:nth-of-type(1)');
  await click(view, '.patch-bay__services .patch-jack.is-target');
  await waitFor(view, "__productionQA.calls.some(call => call.command === 'project_provider_select' && call.args.selection.kind === 'claude' && call.args.selection.providerId)");
  // 管理服务 → 原编辑器，面包屑可返回配线台。
  await clickText(view, "全局默认", '.model-routing__scope');
  await clickText(view, "管理服务", '.model-routing__bar');
  await waitFor(view, "!!document.querySelector('.provider-section .provider-card')");
  await click(view, '.settings-crumb__link');
  await waitFor(view, "!!document.querySelector('.patch-bay')");
  await intact(view, baseline);
});
