import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, intact, resize, waitFor } from "./production-uiFixture.mjs";
import { englishPanel, switchLanguage } from "./i18n-browser-support.mjs";

const nativeExtension = `(() => {
  localStorage.setItem('belfry.locale.v1','en');
  const invoke = __TAURI_INTERNALS__.invoke;
  __TAURI_INTERNALS__.invoke = async (command,args) => {
    if (['agent_hooks_preview','agent_hooks_apply','setup_install_skill','terminal_background_sessions'].includes(command)) {
      __productionQA.calls.push({command,args});
      if (command === 'agent_hooks_preview') return {id:'preview',kind:args.kind,configPath:'/qa/config',enabling:args.enabled,command:'belfry hook',events:['SessionStart'],managedBefore:1};
      if (command === 'agent_hooks_apply') return null;
      if (command === 'setup_install_skill') return {results:[{agent:'codex',action:'installed',path:'/qa/skill',summary:'Installed'}]};
      return [{tabId:'background-task',profileId:'system-default',session:{id:'background-pty',status:'running',shell:'Shell',cwd:'/qa/background',cols:80,rows:24,exitCode:null}}];
    }
    return invoke(command,args);
  };
})();`;

test('English environment, hooks and background sessions remain usable at 720x480', async t => {
  const {view,baseline} = await uiFixture(t,{nativeExtension});
  await resize(view,720,480);
  await click(view,'button[title^="Settings"]');
  await clickText(view,'Collaboration setup','.settings-nav');
  await waitFor(view,"!!document.querySelector('.environment-summary')");
  await englishPanel(view,'.environment-section');
  await clickText(view,'Sync all skills','.environment-section');
  await waitFor(view,"document.querySelector('.environment-notice')?.textContent.includes('Synced 1 client')");
  await switchLanguage(view,'zh-CN');
  assert.match(await view.cdp.evaluate("document.querySelector('.environment-notice').textContent"),/已同步 1 个客户端/);
  await switchLanguage(view,'en');
  await englishPanel(view,'.environment-section');
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.environment-notice').textContent"),/1 clients/);
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'setup_install_skill').length"),1);
  await clickText(view,'Session status','.settings-nav');
  await waitFor(view,"!!document.querySelector('.hook-agent-card')");
  await englishPanel(view,'.hook-settings');
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.hook-settings button[aria-label=\"Preview enabling Codex hooks\"]')"),false);
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.hook-settings button[aria-label=\"Preview enabling Claude Code hooks\"]')"),false);
  assert.match(await englishPanel(view,'.hook-settings'),/Native terminal status/);
  await click(view,'.hook-settings button[aria-label="Preview enabling Antigravity CLI hooks"]');
  await waitFor(view,"!!document.querySelector('.hook-preview')");
  await englishPanel(view,'.hook-preview');
  await switchLanguage(view,'zh-CN');
  await switchLanguage(view,'en');
  assert.match(await englishPanel(view,'.hook-preview'),/Enable Antigravity CLI hooks/);
  await clickText(view,'Confirm and enable','.hook-preview');
  await waitFor(view,"!document.querySelector('.hook-preview')");
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'agent_hooks_apply').length"),1);
  await waitFor(view,"!!document.querySelector('.background-sessions__list li')");
  await englishPanel(view,'.background-sessions');
  await clickText(view,'End','.background-sessions__list');
  await waitFor(view,"!!document.querySelector('.modal__danger')");
  await englishPanel(view,'.modal');
  await clickText(view,'Cancel','.modal');
  await click(view,'button[title="Close settings"]');
  await intact(view,baseline);
});
