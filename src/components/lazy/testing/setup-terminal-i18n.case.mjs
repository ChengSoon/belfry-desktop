import assert from "node:assert/strict";
import test from "node:test";
import { uiFixture, click, clickText, evidence, intact, resize, waitFor } from "./production-uiFixture.mjs";
import { englishPanel, switchLanguage } from "./i18n-browser-support.mjs";

const nativeExtension = `(() => {
  localStorage.setItem('belfry.locale.v1','en');
  const invoke = __TAURI_INTERNALS__.invoke;
  __TAURI_INTERNALS__.invoke = async (command,args) => {
    if (command === 'setup_diagnose') {
      __productionQA.calls.push({command,args});
      return {overall:'ok',checkedAt:1,checks:[
        {id:'codex-a2a-adapter',label:'Codex A2A',state:'ok',summary:'A2A tool readiness was verified for 1 running instance.'},
        {id:'collaboration',label:'Collaboration channel',state:'ok',summary:'The local A2A 1.0 JSON-RPC gateway passed its HTTP check.'},
        {id:'a2a-skill-migration',label:'Collaboration protocol migration',state:'ok',summary:'Collaboration uses A2A tools. Belfry collaboration Skills are no longer installed.'}
      ]};
    }
    if (['agent_hooks_preview','agent_hooks_apply','terminal_background_sessions'].includes(command)) {
      __productionQA.calls.push({command,args});
      if (command === 'agent_hooks_preview') return {id:'preview',kind:args.kind,configPath:'/qa/config',enabling:args.enabled,command:'belfry hook',events:['SessionStart'],managedBefore:1};
      if (command === 'agent_hooks_apply') return null;
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
  assert.match(await view.cdp.evaluate("document.querySelector('.environment-section').textContent"),/Collaboration protocol migration/);
  assert.match(await view.cdp.evaluate("document.querySelector('.environment-section').textContent"),/A2A tools/);
  await evidence(view,'a2a-skill-migration-diagnostics',['.environment-section button']);
  const checks = await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'setup_diagnose').length");
  assert.ok(checks >= 1);
  assert.doesNotMatch(await view.cdp.evaluate("document.querySelector('.environment-section').textContent"),/Sync all skills/);
  await clickText(view,'Check again','.environment-section');
  await waitFor(view,`__productionQA.calls.filter(call => call.command === 'setup_diagnose').length > ${checks} && document.querySelector('.environment-summary')?.dataset.state === 'ok'`);
  await switchLanguage(view,'zh-CN');
  assert.match(await view.cdp.evaluate("document.querySelector('.environment-section').textContent"),/环境就绪/);
  await switchLanguage(view,'en');
  await englishPanel(view,'.environment-section');
  assert.equal(await view.cdp.evaluate("__productionQA.calls.filter(call => call.command === 'setup_install_skill').length"),0);
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
