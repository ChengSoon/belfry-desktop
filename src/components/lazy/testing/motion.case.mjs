import assert from 'node:assert/strict';
import test from 'node:test';
import { uiFixture, click, press, waitFor, resize, intact, evidence, theme, fill } from './production-uiFixture.mjs';
import { assertTerminalInput } from './productionFixture.mjs';

const pause = (view, ms = 260) => view.cdp.evaluate(`new Promise(r => setTimeout(r, ${ms}))`);
// Fixed wall-clock sleeps can observe the last fractional CSS frame on loaded CI.
const settleTerminal = view => view.cdp.evaluate(`(async () => {
  await document.fonts.ready;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve, reject) => {
    const start=performance.now();let last=-1,quiet=start;
    const tick=()=>{const now=performance.now(),count=__productionQA.calls.filter(c=>c.command==='terminal_resize').length;
      if(count!==last){last=count;quiet=now;}
      if(now-quiet>=350 && now-start>=500)return resolve();
      if(now-start>6000)return reject(new Error('terminal resize queue did not settle'));
      setTimeout(tick,50);};tick();
  });
})()`);
async function point(view, selector) {
  return view.cdp.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
}
async function mouse(view, type, selector) {
  await view.send('Input.dispatchMouseEvent', { type, ...await point(view, selector), button:'left', clickCount:1 });
}
const manySessions = `;(() => {
  const w = JSON.parse(localStorage.getItem('belfry.workspace.v1')), base = w.tabs[0];
  w.tabs = Array.from({length:20}, (_,i) => ({...base, id:'motion-session-'+i,
    kind:i===0?'codex':'shell', profileId:i===0?'agent:codex':'system-default',
    customTitle:'Synthetic session '+i, title:'Synthetic session '+i,
    project:{...base.project,id:'motion-project-'+Math.floor(i/10),name:'Synthetic project '+Math.floor(i/10),rootPath:'/qa/motion-'+Math.floor(i/10),rootUri:'file:///qa/motion-'+Math.floor(i/10)}}));
  w.activeTabId=w.tabs[0].id; localStorage.setItem('belfry.workspace.v1',JSON.stringify(w));
})();`;

test('motion: long grouped list, 12 interrupted folds, keyboard exclusion and rename', {timeout:90_000}, async t => {
  const {view, baseline} = await uiFixture(t, { nativeExtension:manySessions, terminalCount:20 });
  await waitFor(view, "document.querySelectorAll('.session-group__head').length === 2");
  for (const mode of ['dark','light']) {
    await theme(view, mode);
    for (const [width,height] of [[1888,1070],[1440,960],[820,500]]) {
      await resize(view,width,height);
      const shape = await view.cdp.evaluate(`(() => {const list=document.querySelector('.session-list'), foot=document.querySelector('.sidebar-foot');
        return {height:document.querySelector('.sidebar').offsetHeight,bottom:foot.getBoundingClientRect().bottom,
          scroll:list.scrollHeight,available:list.clientHeight,overflow:getComputedStyle(list).overflowY};})()`);
      assert.equal(shape.height,height); assert.equal(shape.bottom,height);
      if (height===500) assert.ok(shape.scroll>shape.available && shape.overflow==='auto');
      await evidence(view,`motion-long-list-${mode}-${width}x${height}`);
    }
  }
  await resize(view,1440,960);
  const full = await view.cdp.evaluate("document.querySelector('.session-group__collapse').getBoundingClientRect().height");
  // Observe and trigger in the same browser turn so remote CDP latency cannot skip the transition.
  const frames = await view.cdp.evaluate(`new Promise((resolve,reject) => {
    const el=document.querySelector('.session-group__collapse'),values=[el.getBoundingClientRect().height];
    const deadline=performance.now()+5000;
    const tick=()=>{const height=el.getBoundingClientRect().height;values.push(height);
      if(height===0)return resolve(values);
      if(performance.now()>deadline)return reject(new Error('group collapse did not settle'));
      requestAnimationFrame(tick);};
    document.querySelector('.session-group__head').click();requestAnimationFrame(tick);})`);
  assert.ok(frames.some(h=>h>0 && h<full), 'collapse includes intermediate heights');
  assert.equal(frames.at(-1),0);
  const hidden = await view.cdp.evaluate(`(() => {const content=document.querySelector('.session-group__collapse');content.querySelector('button').focus();
    return {inert:content.inert,focused:content.contains(document.activeElement),expanded:document.querySelector('.session-group__head').getAttribute('aria-expanded')};})()`);
  assert.deepEqual(hidden,{inert:true,focused:false,expanded:'false'});
  // Public DOM control, each click a separate event-loop turn; reverse before animation completes.
  await view.cdp.evaluate(`new Promise(resolve=>{let n=0;const go=()=>{document.querySelector('.session-group__head').click();
    if(++n<12)setTimeout(go,18);else resolve();};go();})`);
  await waitFor(view,"document.querySelector('.session-group__collapse').getBoundingClientRect().height === 0");
  assert.equal(await view.cdp.evaluate("document.querySelector('.session-group__collapse').getBoundingClientRect().height"),0);
  await click(view,'.session-group__head');
  await waitFor(view,`document.querySelector('.session-group__collapse').getBoundingClientRect().height === ${full}`);
  assert.equal(await view.cdp.evaluate("document.querySelector('.session-group__collapse').getBoundingClientRect().height"),full);
  await click(view,'button[aria-label="设置协作名字"]');
  await fill(view,'input[aria-label="协作名字"]','motion-reviewer'); await press(view,'Enter');
  await waitFor(view,"document.querySelector('.session-row__main')?.textContent.includes('motion-reviewer')");
  assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('.session-row__main')"),true);
  await press(view,'F2');
  await waitFor(view,"document.activeElement?.getAttribute('aria-label') === '协作名字'");
  await fill(view,'input[aria-label="协作名字"]','bad name!'); await press(view,'Enter');
  await waitFor(view,"document.querySelector('input[aria-label=\"协作名字\"]')?.getAttribute('aria-invalid') === 'true'");
  assert.equal(await view.cdp.evaluate(`(() => {const input=document.querySelector('input[aria-label="协作名字"]');
    return !!document.getElementById(input.getAttribute('aria-describedby'))?.textContent;})()`),true);
  await press(view,'Escape');
  assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('.session-row__main')"),true);
  await click(view,'button[aria-label="设置协作名字"]');
  await fill(view,'input[aria-label="协作名字"]','discarded-name'); await press(view,'Escape');
  assert.ok(await view.cdp.evaluate("document.querySelector('.session-row__main').textContent.includes('motion-reviewer')"));
  assert.equal(await view.cdp.evaluate("document.activeElement === document.querySelector('.session-row__main')"),true);
  await view.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click(view,'.session-group__head');
  assert.deepEqual(await view.cdp.evaluate(`(() => {const el=document.querySelector('.session-group__collapse');
    return {height:el.getBoundingClientRect().height,inert:el.inert,duration:getComputedStyle(el).transitionDuration};})()`),
    {height:0,inert:true,duration:'0s'});
  await click(view,'.session-group__head');
  assert.equal(await view.cdp.evaluate("document.querySelector('.session-group__collapse').getBoundingClientRect().height"),full);
  await intact(view,baseline); await assertTerminalInput(view);
  t.diagnostic(JSON.stringify({foldSamples:frames,rapidReversals:12,syntheticSessions:20}));
});

test('motion: hover and press feedback without layout movement, disabled and reduced motion', {timeout:45_000}, async t => {
  const {view,baseline} = await uiFixture(t);
  const row='.session-row:nth-child(2)';
  const before=await view.cdp.evaluate(`getComputedStyle(document.querySelector('${row}')).backgroundColor`);
  await mouse(view,'mouseMoved',row); await pause(view,150);
  const hover=await view.cdp.evaluate(`getComputedStyle(document.querySelector('${row}')).backgroundColor`);
  assert.notEqual(hover,before);
  const button=row+' .session-row__main';
  const measure=()=>view.cdp.evaluate(`(() => {const el=document.querySelector('${button}'),css=getComputedStyle(el);
    return {width:el.offsetWidth,height:el.offsetHeight,scale:css.scale,shadow:css.boxShadow};})()`);
  const original=await measure(); await mouse(view,'mousePressed',button); await pause(view,150);
  const held=await measure(); assert.equal(held.width,original.width); assert.equal(held.height,original.height);
  assert.ok(Math.abs(Number(held.scale)-.98)<.001, JSON.stringify(held)); assert.notEqual(held.shadow,'none');
  await mouse(view,'mouseReleased',button);
  await waitFor(view,`document.querySelector('${button}').getAttribute('aria-current') === 'true'`);
  await click(view,'button[title^="历史会话"]');
  await waitFor(view,"!!document.querySelector('.history-head')");
  await pause(view);
  // Disabled production button state via its real loading API: hold the synthetic reload promise.
  await view.cdp.evaluate(`(() => {const original=__TAURI_INTERNALS__.invoke;__TAURI_INTERNALS__.invoke=(cmd,args)=>cmd==='history_search'
    ?new Promise(resolve=>{__productionQA.releaseHistory=()=>original(cmd,args).then(resolve);}) : original(cmd,args);})()`);
  await click(view,'button[title="重新扫描会话日志"]');
  await waitFor(view,`document.querySelector('button[title="重新扫描会话日志"]').disabled`);
  await mouse(view,'mousePressed','button[title="重新扫描会话日志"]'); await pause(view,150);
  assert.equal(await view.cdp.evaluate(`getComputedStyle(document.querySelector('button[title="重新扫描会话日志"]')).scale`),'none');
  await mouse(view,'mouseReleased','button[title="重新扫描会话日志"]');
  await view.cdp.evaluate('__productionQA.releaseHistory()');
  await click(view,'button[title="关闭历史会话"]'); await waitFor(view,"!document.querySelector('.history-panel')");
  await view.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await mouse(view,'mousePressed',button);
  assert.equal((await measure()).scale,'none'); await mouse(view,'mouseReleased',button);
  await intact(view,baseline);
});

test('motion: Quick Open and confirmation entry/exit, focus, no duplicate confirmation or stale scrim', {timeout:60_000}, async t => {
  const {view,baseline}=await uiFixture(t, {nativeExtension:`;(() => {
    const recent=JSON.parse(localStorage.getItem('belfry.recent-projects.v1'));
    recent.push({id:'unused-project',name:'Unused synthetic project',rootPath:'/qa/unused',rootUri:'file:///qa/unused'});
    localStorage.setItem('belfry.recent-projects.v1',JSON.stringify(recent));
  })();`});
  await click(view,'button[aria-label="Quick Open"]'); await waitFor(view,"!!document.querySelector('.quick-open input')");
  assert.equal(await view.cdp.evaluate("document.querySelector('.quick-open__scrim').dataset.motionState"),'open');
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.quick-open')).animationName"),'motion-dialog-in');
  await press(view,'Escape');
  assert.deepEqual(await view.cdp.evaluate(`(() => {const el=document.querySelector('.quick-open__scrim');return {state:el.dataset.motionState,inert:el.inert,pointer:getComputedStyle(el).pointerEvents};})()`),{state:'exit',inert:true,pointer:'none'});
  await waitFor(view,`document.activeElement?.getAttribute('aria-label') === 'Quick Open'`);
  // Reopen before the old removal deadline: same surface, no delayed unmount.
  await view.cdp.evaluate(`document.querySelector('button[aria-label="Quick Open"]').click()`);
  await pause(view);
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.quick-open').length"),1);
  assert.equal(await view.cdp.evaluate("document.activeElement.getAttribute('role')"),'combobox');
  await view.send('Input.dispatchMouseEvent',{type:'mousePressed',x:10,y:300,button:'left',clickCount:1});
  await view.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:10,y:300,button:'left',clickCount:1});
  await waitFor(view,"!document.querySelector('.quick-open')");
  await click(view,'.project-trigger'); await click(view,'.popover-list__delete');
  await waitFor(view,"!!document.querySelector('.modal__danger')");
  assert.equal(await view.cdp.evaluate("document.activeElement.textContent"),'取消');
  await press(view,'Tab'); assert.equal(await view.cdp.evaluate("document.activeElement.className"),'modal__danger');
  await press(view,'Tab'); assert.equal(await view.cdp.evaluate("document.activeElement.textContent"),'取消');
  await press(view,'Escape');
  assert.equal(await view.cdp.evaluate("document.querySelector('.modal-scrim').dataset.motionState"),'exit');
  await waitFor(view,"document.activeElement?.classList.contains('popover-list__delete')");
  await waitFor(view,"!document.querySelector('.modal-scrim')");
  await click(view,'.popover-list__item:last-child .popover-list__delete'); await pause(view);
  // Count storage writes caused by actual confirm handler; dispatch twice in the same turn.
  await view.cdp.evaluate(`(() => {const original=Storage.prototype.setItem;__productionQA.removes=0;
    Storage.prototype.setItem=function(key,value){if(key==='belfry.recent-projects.v1')__productionQA.removes++;return original.call(this,key,value);};
    const button=document.querySelector('.modal__danger');button.click();button.click();})()`);
  await waitFor(view,"!document.querySelector('.modal-scrim')");
  assert.equal(await view.cdp.evaluate('__productionQA.removes'),1);
  await intact(view,baseline);
});

test('motion: drawer switch/interruptions, terminal resize bounded and reduced-motion removal', {timeout:90_000}, async t => {
  const {view,baseline}=await uiFixture(t);
  const snapshots=[];
  for (const mode of ['dark','light']) {
    await theme(view,mode);
    for (const [width,height] of [[1888,1070],[1440,960],[820,500]]) {
      await resize(view,width,height); await settleTerminal(view);
      await view.cdp.evaluate(`(() => {__productionQA.resizeStart=__productionQA.calls.length;
        __productionQA.sizes=[];__productionQA.layoutSizes=[];
        __productionQA.observer=new ResizeObserver(entries=>{const r=entries[0].contentRect;
          __productionQA.sizes.push(r.width);__productionQA.layoutSizes.push({width:r.width,height:r.height});});
        __productionQA.observer.observe(document.querySelector('.terminal-stage'));})()`);
      await click(view,'button[aria-label="会话协作"]');
      await waitFor(view,"!!document.querySelector('.collab-panel')");
      await pause(view);
      await evidence(view,`motion-collab-${mode}-${width}x${height}`,['button[aria-label="关闭协作面板"]']);
      await click(view,'button[title^="历史会话"]');
      await waitFor(view,"!!document.querySelector('.history-head')");
      await pause(view);
      assert.equal(await view.cdp.evaluate("document.querySelectorAll('.motion-drawer').length"),1);
      await evidence(view,`motion-history-${mode}-${width}x${height}`,['button[title="关闭历史会话"]']);
      await click(view,'button[title="关闭历史会话"]');
      assert.equal(await view.cdp.evaluate("document.querySelector('.motion-drawer').dataset.motionState"),'exit');
      assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.motion-drawer')).position"),'absolute');
      await waitFor(view,"!document.querySelector('.motion-drawer')");
      await settleTerminal(view);
      const counts=await view.cdp.evaluate(`(() => {__productionQA.observer.disconnect();
        const resizeCalls=__productionQA.calls.slice(__productionQA.resizeStart).filter(c=>c.command==='terminal_resize');
        return {sizes:__productionQA.sizes,layoutSizes:__productionQA.layoutSizes,resizes:resizeCalls.length,resizeCalls};})()`);
      assert.ok(counts.sizes.length<=5,JSON.stringify(counts)); assert.ok(counts.resizes<=6,JSON.stringify(counts));
      snapshots.push({mode,width,height,...counts}); await intact(view,baseline);
    }
  }
  await resize(view,1440,960);
  // The opener itself must close rather than outside-mousedown closing then click reopening.
  await click(view,'button[aria-label="会话协作"]'); await pause(view);
  await click(view,'button[aria-label="会话协作"]'); await pause(view);
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.motion-drawer').length"),0);
  // 12 rapid open/close pairs; no ghosts or occupied track after the final close.
  await view.cdp.evaluate(`new Promise(resolve=>{let n=0;const toggle=()=>{document.querySelector('button[title^="历史会话"]').click();
    if(++n<24)setTimeout(toggle,20);else resolve();};toggle();})`); await pause(view);
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.motion-drawer').length"),0);
  await view.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await click(view,'button[title^="历史会话"]'); await waitFor(view,"!!document.querySelector('.history-head')");
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.motion-drawer')).animationName"),'none');
  await click(view,'button[title="关闭历史会话"]');
  assert.equal(await view.cdp.evaluate("document.querySelectorAll('.motion-drawer').length"),0);
  await click(view,'button[aria-label="Quick Open"]'); await waitFor(view,"!!document.querySelector('.quick-open input')");
  assert.equal(await view.cdp.evaluate("getComputedStyle(document.querySelector('.quick-open')).animationName"),'none');
  await press(view,'Escape'); assert.equal(await view.cdp.evaluate("document.querySelectorAll('.modal-scrim').length"),0);
  await intact(view,baseline); await assertTerminalInput(view);
  t.diagnostic(JSON.stringify({layoutAndResizeSamples:snapshots,rapidDrawerToggles:24}));
});
