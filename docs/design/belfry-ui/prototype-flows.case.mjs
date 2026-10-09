import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, click, fill, press, wait, screenshot, assertClean } from './browser-fixture.mjs';
const id = name => `[data-testid="${name}"]`;
const act = name => `[data-action="${name}"]`;
const navigate = (view, route) => view.cdp.evaluate(`belfryPrototype.navigate(${JSON.stringify(route)});true`);
const state = view => view.cdp.evaluate('belfryPrototype.state');
const text = view => view.cdp.evaluate('document.querySelector("main").innerText');

// Testing values are synthetic and live only in the disposable browser context.
test('Provider explicit actions reject ambiguous values and clear secret input after saving', async t => {
  const f=await fixture(t), {view}=f;
  await navigate(view,'settings/provider');
  await screenshot(view,'provider-overview');
  await click(view,id('provider-edit'));
  assert.equal(await view.cdp.evaluate('document.querySelector("#provider-key").value'),'');
  assert.equal(await view.cdp.evaluate('document.querySelector("input[name=keyAction]:checked").value'),'keep');
  await fill(view,id('provider-endpoint'),'https://changed.example.invalid/v1');
  await click(view,id('provider-save'));
  assert.match(await view.cdp.evaluate('document.querySelector("#provider-error").textContent'),/端点.*更改.*不能保留/);
  await click(view,'input[name=keyAction][value=replace]');
  await click(view,id('provider-save'));
  assert.match(await view.cdp.evaluate('document.querySelector("#provider-error").textContent'),/非空/);
  await fill(view,id('provider-key'),'synthetic-design-input-not-real');
  const snapshot=await state(view);
  assert.equal(JSON.stringify(snapshot).includes('synthetic-design-input-not-real'),false,'Debug state never contains key text');
  await screenshot(view,'provider-edit');
  await click(view,id('provider-save'));
  await wait(view,'!document.querySelector("dialog[open]")');
  assert.equal(await view.cdp.evaluate('document.querySelector("#provider-key")'),null);
  assert.match(await text(view),/changed\.example\.invalid/);
  await click(view,id('provider-edit'));
  await click(view,'input[name=keyAction][value=clear]');
  await click(view,id('provider-save'));
  assert.equal((await state(view)).providers[0].configured,false);
  await click(view,act('provider-new'));
  assert.equal(await view.cdp.evaluate('document.querySelector("input[name=keyAction][value=keep]").disabled'),true);
  await press(view,'Escape');
  await assertClean(f);
});

test('Provider dirty close, route changes, confirmation cancellation and modal focus trap', async t => {
  const f=await fixture(t), {view}=f;
  await navigate(view,'settings/provider');
  await click(view,id('provider-edit'));
  await fill(view,'#provider-name','演示编辑中的服务');
  // Real keyboard traversal stays within the current native modal.
  for(let i=0;i<16;i++) {
    await press(view,'Tab');
    assert.equal(await view.cdp.evaluate('document.querySelector("#modal").contains(document.activeElement)'),true);
  }
  await click(view,id('modal-close'));
  await wait(view,'document.querySelector("#confirm-modal").open');
  await screenshot(view,'unsaved-confirmation');
  await click(view,act('continue-edit'));
  assert.equal(await view.cdp.evaluate('document.querySelector("#provider-name").value'),'演示编辑中的服务');
  // Route entry is the same production-like navigation guard used by all DOM links.
  await navigate(view,'history');
  assert.equal((await state(view)).route,'settings/provider');
  assert.equal(await view.cdp.evaluate('document.querySelector("#confirm-modal").open'),true);
  await click(view,id('discard-changes'));
  assert.equal((await state(view)).route,'history');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("#provider-key")'),false);
  await assertClean(f);
});

test('raw configuration requires explicit consent and is removed on close or route change', async t => {
  const f=await fixture(t), {view}=f;
  await navigate(view,'settings/provider');
  assert.equal(await view.cdp.evaluate('!!document.querySelector("textarea")'),false);
  await click(view,id('reveal-secrets'));
  assert.equal(await view.cdp.evaluate('!!document.querySelector("[data-testid=raw-config]")'),false);
  await click(view,'[data-change="raw-optin"]');
  assert.match(await view.cdp.evaluate('document.querySelector("[data-testid=raw-config]").value'),/DEMO_ONLY_NOT_A_REAL_SECRET/);
  await press(view,'Escape');
  assert.equal(await view.cdp.evaluate('document.querySelector("#modal").innerHTML'),'');
  await click(view,id('reveal-secrets'));
  assert.equal(await view.cdp.evaluate('!!document.querySelector("[data-testid=raw-config]")'),false,'Consent does not survive reopening');
  await click(view,'[data-change="raw-optin"]');
  await navigate(view,'settings/about');
  assert.equal(await view.cdp.evaluate('document.querySelector("#modal").innerHTML'),'');
  await assertClean(f);
});

test('new session, split controls, project switching and history restore update demo state', async t => {
  const f=await fixture(t), {view}=f;
  const before=(await state(view)).sessions.length;
  await click(view,'.workspace-head '+act('new-session'));
  await fill(view,'#session-name','浏览器交互验证 · 合成');
  await click(view,'dialog[open] button[type=submit]');
  assert.equal((await state(view)).sessions.length,before+1);
  assert.match(await text(view),/浏览器交互验证/);
  await click(view,act('split'));
  assert.equal(await view.cdp.evaluate('document.querySelectorAll(".terminal-pane").length'),1);
  await fill(view,'[data-change=project]','1');
  assert.equal((await state(view)).project,1);
  await navigate(view,'history');
  await fill(view,'[data-search=history]','no-such-synthetic-session');
  assert.match(await text(view),/没有找到会话/);
  await click(view,act('history-reset'));
  await click(view,act('history-restore'));
  assert.equal((await state(view)).sessions.length,before+2);
  assert.match(await text(view),/恢复/);
  await assertClean(f);
});

test('collaboration result, plugin permissions, usage scope and SSH error recovery work locally', async t => {
  const f=await fixture(t), {view}=f;
  await navigate(view,'collab');
  await click(view,act('collab-detail'));
  await click(view,act('collab-accept'));
  assert.equal((await state(view)).collabs[0].status,'done');
  await click(view,'[data-action=collab-filter][data-value=done]');
  assert.match(await text(view),/界面细节审查/);
  await navigate(view,'plugins');
  await click(view,act('plugin-detail'));
  assert.match(await view.cdp.evaluate('document.querySelector("#modal").innerText'),/声明权限/);
  await press(view,'Escape');
  await click(view,act('plugin-toggle'));
  assert.equal((await state(view)).plugins[0].enabled,false);
  await screenshot(view,'plugins-overview');
  await navigate(view,'usage');
  const all=await text(view);
  await fill(view,'[data-change=usage-scope]','project');
  assert.notEqual(await text(view),all);
  await screenshot(view,'usage-overview');
  await navigate(view,'ssh');
  await click(view,act('ssh-error'));
  await wait(view,'belfryPrototype.state.sshStatus === "error"');
  assert.match(await text(view),/(?:未|没有).*网络请求/);
  await click(view,act('ssh-connect'));
  await wait(view,'belfryPrototype.state.sshStatus === "success"');
  assert.match(await text(view),/未建立 SSH 通道/);
  await assertClean(f);
});

test('all settings fit narrow and zoom-equivalent viewports, with readable theme contrast', {timeout:60000}, async t => {
  const f=await fixture(t), {view}=f;
  await navigate(view,'settings/appearance');
  const routes=await view.cdp.evaluate('[...document.querySelectorAll(".settings-nav [data-route]")].map(e=>e.dataset.route)');
  for(const [width,height] of [[1024,768],[820,900],[720,480]]) {
    await view.bounds({x:0,y:0,width,height});
    for(const route of routes) {
      await navigate(view,route);
      assert.equal(await view.cdp.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),true,`${route} ${width}: page fits`);
      assert.equal(await view.cdp.evaluate('document.querySelector("main").scrollWidth <= document.querySelector("main").clientWidth+1'),true,`${route} ${width}: panel fits`);
    }
    await screenshot(view,`settings-narrow-${width}`);
  }
  await view.bounds({x:0,y:0,width:1440,height:960});
  await navigate(view,'settings/appearance');
  await screenshot(view,'settings-appearance');
  // Test base content and muted text pairs in both actual themes, not invented color values.
  for(const theme of ['light','dark']) {
    if((await state(view)).theme!==theme)await click(view,id('theme-toggle'));
    const ratios=await view.cdp.evaluate(`(()=>{
      const probe=document.createElement('span');document.body.append(probe);
      const rgb=value=>{probe.style.color=value;return getComputedStyle(probe).color.match(/[\\d.]+/g).slice(0,3).map(Number);};
      const lum=c=>c.map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
      const css=getComputedStyle(document.documentElement), bg=lum(rgb(css.getPropertyValue('--bg')));
      const ratios=['--ink','--muted'].map(key=>{const x=lum(rgb(css.getPropertyValue(key)));return(Math.max(x,bg)+.05)/(Math.min(x,bg)+.05);});
      probe.remove();return ratios;
    })()`);
    assert.ok(ratios.every(r=>r>=4.5),`${theme} base and muted contrast: ${ratios}`);
  }
  await assertClean(f);
});
