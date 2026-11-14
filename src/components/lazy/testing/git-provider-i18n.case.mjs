import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, fill, intact, resize, waitFor } from "./production-uiFixture.mjs";
import { englishPanel, openAction, switchLanguage } from "./i18n-browser-support.mjs";

const nativeExtension = `(() => {
  localStorage.setItem('belfry.locale.v1', 'en');
  const invoke = __TAURI_INTERNALS__.invoke;
  __TAURI_INTERNALS__.invoke = async (command,args) => {
    if (command === 'worktree_list') {
      __productionQA.calls.push({command,args});
      return { rootPath:args.rootPath, branch:'main', branches:['main'], worktrees:[], managed:[] };
    }
    const result = await invoke(command,args);
    if (command === 'project_provider_report') result.agents.forEach(group => { group.effectiveName = 'Official login'; });
    return result;
  };
})();`;

test('English Git preserves diff selection and refreshes group labels when switching language', async t => {
  const {view,baseline} = await uiFixture(t, {nativeExtension});
  await resize(view,720,480);
  await openAction(view,'open file preview');
  await click(view,'button[aria-label="View Git changes"]');
  await waitFor(view,"!!document.querySelector('.git-file__select')");
  await click(view,'.git-file__select');
  await waitFor(view,"!!document.querySelector('.git-diff__table')");
  await englishPanel(view,'.git-panel');
  await view.cdp.evaluate("void (window.qaSelectedDiff = document.querySelector('.git-diff__table'))");
  await switchLanguage(view,'zh-CN');
  await waitFor(view,"[...document.querySelectorAll('.git-file-group h3')].some(el => el.textContent.includes('未暂存'))");
  await switchLanguage(view,'en');
  await waitFor(view,"[...document.querySelectorAll('.git-file-group h3')].some(el => el.textContent.includes('Unstaged'))");
  assert.equal(await view.cdp.evaluate("window.qaSelectedDiff === document.querySelector('.git-diff__table')"),true);
  await englishPanel(view,'.git-panel');
  await click(view,'.worktree-entry');
  await waitFor(view,"!!document.querySelector('.worktree-dialog input')");
  await englishPanel(view,'.worktree-dialog');
  await click(view,'button[aria-label="Close worktrees"]');
  await click(view,'button[aria-label="Close Git panel"]');
  await waitFor(view,"!document.querySelector('.git-panel')");
  await intact(view,baseline);
});

test('English provider editor keeps unsaved fields across locale changes and saves at 720x480', async t => {
  const {view,baseline} = await uiFixture(t, {nativeExtension});
  await resize(view,720,480);
  await click(view,'button[title^="Settings"]');
  // 模型服务默认是配线台；服务编辑器在「Manage services」里（T41）。
  await clickText(view,'Model services','.settings-nav');
  await waitFor(view,"!!document.querySelector('.patch-bay')");
  await englishPanel(view,'.model-routing');
  await clickText(view,'Manage services','.model-routing__bar');
  await waitFor(view,"!!document.querySelector('.provider-card')");
  await englishPanel(view,'.provider-section');
  await click(view,'.provider-card button[aria-label^="Edit "]');
  await waitFor(view,"!!document.querySelector('#provider-name')");
  await fill(view,'#provider-name','Long provider name kept across a language switch');
  await view.cdp.evaluate("void (window.qaProviderInput = document.querySelector('#provider-name'))");
  await switchLanguage(view,'zh-CN');
  await waitFor(view,"document.querySelector('.provider-form')?.textContent.includes('保存配置')");
  await switchLanguage(view,'en');
  await waitFor(view,"document.querySelector('.provider-form')?.textContent.includes('Save configuration')");
  assert.equal(await view.cdp.evaluate("qaProviderInput === document.querySelector('#provider-name') && qaProviderInput.value === 'Long provider name kept across a language switch'"),true);
  await englishPanel(view,'.provider-section');
  await clickText(view,'Save configuration','.provider-form');
  await waitFor(view,"!document.querySelector('.provider-form')");
  assert.equal(await view.cdp.evaluate("__productionQA.savedProviders.at(-1).draft.name"),'Long provider name kept across a language switch');
  // 项目覆盖并入配线台的项目作用域。
  await click(view,'.settings-crumb__link');
  await waitFor(view,"!!document.querySelector('.patch-bay')");
  await clickText(view,'Project','.model-routing__scope');
  await waitFor(view,"document.querySelector('.patch-bay__services .patch-jack b')?.textContent === 'Follow global'");
  await englishPanel(view,'.model-routing');
  await click(view,'button[title="Close settings"]');
  await intact(view,baseline);
});
