import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, press, waitFor, fill, setValue, resize, intact, evidence, theme, settings, menuAction, clickOption } from "./production-uiFixture.mjs";

const SETTINGS_CLOSE = 'button[title="关闭设置"]';
const SESSION_A = '.session-row__main[aria-label^="Alpha"]';
const SESSION_B = '.session-row__main[aria-label^="Beta"]';

test("production UI workbench themes, session selection, real drag split and Quick Open keyboard", { timeout: 90_000 }, async t => {
  const { view, baseline, requests } = await uiFixture(t);
  assert.ok(requests.some(request => /\/assets\/index-.*\.js/.test(request.url)));
  assert.ok(!requests.some(request => /docs\/design|@vite|src\/App/.test(request.url)), "only production assets are served");
  for (const mode of ["dark", "light"]) {
    await theme(view, mode);
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768]]) {
      await resize(view, width, height);
      await evidence(view, `workbench-${mode}-${width}x${height}`, ['button[aria-label="Quick Open"]', 'button[title^="设置"]']);
      assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.sidebar')).backgroundColor"),
        mode === "dark" ? "rgb(32, 36, 34)" : "rgb(238, 238, 231)", "Production sidebar uses the settled Graphite theme");
      await intact(view, baseline);
    }
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
  const sections = ["外观", "快捷键", "全局 Provider", "项目 Provider", "会话状态", "插件", "本地备份", "协作环境", "关于"];
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
  await settings(view, "全局 Provider");
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
    await settings(view, "全局 Provider");
    for (const [width, height] of [[1440, 960], [1024, 768], [820, 768]]) {
      await resize(view, width, height);
      await evidence(view, `provider-original-cards-${mode}-${width}x${height}`, [SETTINGS_CLOSE]);
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
      assert.deepEqual({ ...layout, columns: 0 }, { count:"3", columns:0, cardColumns:1, radius:"10px", border:"1px", segments:"grid", scopeBadges:0 });
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
  await intact(view, baseline);
});

test("production UI Provider keep replace clear, explicit raw consent and search preserves guarded editor", { timeout: 90_000 }, async t => {
  const { view, baseline } = await uiFixture(t);
  await settings(view, "全局 Provider");
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
  await settings(view, '插件');
  await waitFor(view, "!!document.querySelector('.plugins-row-details-toggle')");
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
      await evidence(view, `history-${stamp}`, ['input[aria-label="搜索历史正文"]']);
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
