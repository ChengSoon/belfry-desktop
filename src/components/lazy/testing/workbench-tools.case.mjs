import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { enter } from '../../../../scripts/plugin-tests/market-ui-support.mjs';
import { uiFixture, click, clickText, press, waitFor, resize, intact, evidence, theme, menuAction } from './production-uiFixture.mjs';

const OUT = process.env.BELFRY_TOOLS_OUT ?? 'docs/design/belfry-ui/workbench-tools/after';
const agents = `(() => {
  const w=JSON.parse(localStorage.getItem('belfry.workspace.v1'));
  w.tabs=w.tabs.map(tab=>({...tab,kind:'codex',profileId:'agent:codex',resumeSessionId:'synthetic-'+tab.id}));
  localStorage.setItem('belfry.workspace.v1',JSON.stringify(w));
  const original=window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke=async(command,args={})=>{
    if(command==='worktree_list'){__productionQA.calls.push({command,args});return {rootPath:args.rootPath,branch:'main',branches:['main'],worktrees:[],managed:[]};}
    if(command==='session_statistics'){__productionQA.calls.push({command,args});return {session:args.query.session,tokens:{input:1200,cachedInput:400,cacheWrite:0,output:250},models:['synthetic-codex'],currentModel:'synthetic-codex',tools:[{name:'read_file',calls:3}],toolCount:3,updatedAt:1700000000,observedAt:1700000000,sourceFiles:1,scannedBytes:512,pending:false,skippedLines:0,note:null};}
    return original(command,args);
  };
})();`;

async function capture(view,name){
  await view.cdp.evaluate('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,240)))');
  const {data}=await view.send('Page.captureScreenshot',{format:'png'});
  await writeFile(`${OUT}/${name}.png`,Buffer.from(data,'base64'));
}

for(const platform of ['macos','windows']){
 test(`${platform} approved three tools, one status row, menus, split and terminal continuity`,{timeout:90_000},async t=>{
  const {view,baseline}=await uiFixture(t,{nativeExtension:agents+`Object.defineProperty(navigator,'userAgent',{configurable:true,value:${JSON.stringify(platform==='macos'?'Macintosh':'Windows NT 10.0')}});`});
  await mkdir(OUT,{recursive:true});
  const geometry=[];
  for(const mode of ['dark','light']){
   await theme(view,mode);
   for(const [width,height] of [[1440,960],[720,480]]){
    await resize(view,width,height);
    await evidence(view,`tools-${platform}-${mode}-${width}`,['.workbench-split','.workbench-inspector','.workbench-more > button','.terminal-pane.is-onstage .session-stats-trigger']);
    const shape=await view.cdp.evaluate(`(()=>{
      const tools=document.querySelector('.workbench-toolbar__tools'),bar=document.querySelector('.terminal-pane.is-onstage .terminal-pane__bar'),stats=document.querySelector('.terminal-pane.is-onstage .session-stats-trigger');
      const b=bar.getBoundingClientRect(),s=stats.getBoundingClientRect();
      return {buttons:tools.querySelectorAll('button').length,gap:getComputedStyle(tools).gap,barHeight:b.height,sameRow:s.top>=b.top&&s.bottom<=b.bottom,icon:getComputedStyle(stats.querySelector('svg')).width,legacy:!!document.querySelector('.agent-session-toolbar'),bodyTop:document.querySelector('.terminal-pane.is-onstage .terminal-pane__body').getBoundingClientRect().top,barBottom:b.bottom};
    })()`);
    assert.equal(shape.buttons,3);assert.equal(shape.gap,'2px');assert.equal(shape.barHeight,34);assert.equal(shape.sameRow,true);assert.equal(shape.icon,'13px');assert.equal(shape.legacy,false);assert.equal(shape.bodyTop,shape.barBottom);
    geometry.push({platform,mode,width,height,...shape});
    await view.cdp.evaluate("document.querySelector('.terminal-pane.is-onstage .xterm-helper-textarea').focus()");
    await capture(view,`${platform}-${mode}-${width}`);
    await click(view,'.workbench-more > button');
    await waitFor(view,"!!document.querySelector('.workbench-menu')");
    assert.equal(await view.cdp.evaluate("document.querySelector('.workbench-menu').textContent.includes('2 条 Agent 会话正在共用这个目录')"),true);
    await view.cdp.evaluate("document.querySelector('.workbench-menu').scrollTop=9999");
    await evidence(view,`menu-tail-${platform}-${mode}-${width}`,['.workbench-menu button:last-child']);
    await capture(view,`${platform}-${mode}-${width}-menu`);
    await press(view,'Escape');
    assert.equal(await view.cdp.evaluate("document.activeElement===document.querySelector('.workbench-more > button')"),true);
    await click(view,'.terminal-pane.is-onstage .session-stats-trigger');
    await waitFor(view,"document.querySelector('.session-stats-popover')?.textContent.includes('synthetic-codex')");
    await evidence(view,`stats-${platform}-${mode}-${width}`,['.session-stats-popover button']);
    assert.equal(await view.cdp.evaluate("document.body.classList.contains('is-dragging-session')"),false);
    await capture(view,`${platform}-${mode}-${width}-stats`);
    await press(view,'Escape');
    assert.equal(await view.cdp.evaluate("document.activeElement.matches('.session-stats-trigger')"),true);
   }
  }
  await resize(view,1440,960);
  await click(view,'.workbench-split');
  await waitFor(view,"!!document.querySelector('.workbench-split-menu .workbench-menu')");
  await waitFor(view,"document.activeElement?.matches('.workbench-split-menu .workbench-menu button')");
  await enter(view);
  await waitFor(view,"document.querySelectorAll('.terminal-pane.is-onstage.is-split').length===2");
  assert.equal(await view.cdp.evaluate("document.querySelector('.workbench-split').disabled"),true);
  await capture(view,`${platform}-split`);await intact(view,baseline);
  // Removing a pane retains its PTY and makes it available in the picker again.
  await view.cdp.evaluate("document.querySelector('.terminal-pane.is-onstage .terminal-pane__close').focus()");
  await enter(view);
  await waitFor(view,"document.querySelectorAll('.terminal-pane.is-onstage').length===1");
  assert.equal(await view.cdp.evaluate("document.querySelector('.workbench-split').disabled"),false);
  // Worktree dialog must survive More unmounting and return focus to the stable trigger.
  await menuAction(view,'使用独立任务目录');
  await waitFor(view,"!!document.querySelector('.worktree-dialog .worktree-new')");
  assert.equal(await view.cdp.evaluate("!!document.querySelector('.workbench-menu')"),false);
  await capture(view,`${platform}-worktree`);
  await press(view,'Escape');
  await waitFor(view,"!document.querySelector('.worktree-dialog')");
  assert.equal(await view.cdp.evaluate("document.activeElement===document.querySelector('.workbench-more > button')"),true);
  await menuAction(view,'会话协作');await waitFor(view,"!!document.querySelector('.collab-panel')");
  await menuAction(view,'会话协作');await waitFor(view,"!document.querySelector('.collab-panel')");
  await click(view,'button[aria-label="收起侧栏"]');
  await waitFor(view,"document.querySelector('.sidebar-shell').inert");
  await menuAction(view,'Quick Open');await waitFor(view,"!!document.querySelector('.quick-open input')");
  await press(view,'Escape');await waitFor(view,"!document.querySelector('.quick-open')");
  assert.equal(await view.cdp.evaluate("document.activeElement===document.querySelector('.workbench-more > button')"),true);
  await intact(view,baseline);
  await writeFile(`${OUT}/${platform}-geometry.json`,JSON.stringify(geometry,null,2));
 });
}
