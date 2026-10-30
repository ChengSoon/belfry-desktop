// 使用仓库已有 CDP 包装器，在一次性 Chrome profile 中验证静态原型。
// 不加载应用，不连接真实邮箱，不使用用户浏览器或剪贴板。
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BrowserProcess } from '../../../../src-tauri/src/plugins/node/browser-process.mjs';
import { BrowserTarget } from '../../../../src-tauri/src/plugins/node/browser-target.mjs';

const prototype = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
export async function fixture(t, dimensions = { width: 1440, height: 1000 }) {
  const temporary = await mkdtemp(join(tmpdir(),'mail-ai-prototype-'));
  let server, browser, view;
  const requests = [], errors = [], externalRequests = [];
  t.after(async()=>{
    if (view) await view.close();
    if (browser) await browser.close();
    if (server) await new Promise(done=>{ server.close(done); server.closeAllConnections(); });
    await rm(temporary,{ recursive: true, force: true });
  });
  server = createServer(async(req,res)=>{
    const pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname), path = resolve(prototype,'.' + pathname);
    const record = { path: pathname, status: null }; requests.push(record);
    try {
      if (!path.startsWith(prototype) || !mime[extname(path)]) throw new Error('Not an allowed prototype asset');
      const body = await readFile(path); record.status = 200;
      res.writeHead(200,{ 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store' }); res.end(body);
    } catch { record.status = 404; res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser = await new BrowserProcess(join(temporary,'chrome')).start();
  view = await new BrowserTarget(browser,{ workspace: temporary, frame() {}, state() {} }).start();
  browser.on('protocol',message=>{
    if (message.sessionId !== view.sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Network.requestWillBeSent') {
      const url = message.params.request.url;
      if (!url.startsWith('http://127.0.0.1:') && !url.startsWith('data:') && !url.startsWith('file:') && !url.startsWith('blob:')) externalRequests.push(url);
    }
  });
  await view.send('Network.enable');
  await view.bounds({ x: 0, y: 0, ...dimensions });
  const url = `http://127.0.0.1:${server.address().port}/prototype.html`;
  await view.navigate({ url });
  await wait(view,'window.__ready === true');
  await view.cdp.evaluate('document.fonts.ready.then(()=>true)');
  return { view, requests, errors, externalRequests, url };
}
export async function wait(view, expression, timeout = 8000) {
  return view.cdp.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+${timeout};const poll=()=>{try{if(${expression}){resolve(true);return;}}catch{}if(Date.now()>end){reject(new Error('Timed out: '+${JSON.stringify(expression)}));return;}setTimeout(poll,25);};poll();})`);
}
export async function click(view, selector) {
  // 将控件定位到其最近可滚动祖先中；不依赖 scrollIntoView。
  await view.cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing '+${JSON.stringify(selector)});if(e.disabled)throw new Error('Disabled control');let p=e.parentElement;while(p){const css=getComputedStyle(p);if(/auto|scroll/.test(css.overflowY)&&p.scrollHeight>p.clientHeight){const r=e.getBoundingClientRect(),pr=p.getBoundingClientRect();p.scrollTop+=r.top-pr.top-p.clientHeight/2+r.height/2;}p=p.parentElement;}const r=e.getBoundingClientRect();window.scrollBy(0,r.top-innerHeight/2+r.height/2);return true;})()`);
  await wait(view,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!top&&(top===e||e.contains(top));})()`);
  const rect = await view.cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};})()`);
  assert.ok(rect.width && rect.height,'Visible click target ' + selector);
  for (const type of ['mousePressed','mouseReleased']) await view.send('Input.dispatchMouseEvent',{ type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
}
export async function fill(view, selector, value) {
  await view.cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing field');e.focus();e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
}
export async function press(view, key, modifiers = 0) {
  const codes = { Escape: 27, Enter: 13, Tab: 9, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35 };
  for (const type of ['keyDown','keyUp']) await view.send('Input.dispatchKeyEvent',{ type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers, ...(type === 'keyDown' && key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}) });
}
export async function screenshot(view, name, focusSelector = null) {
  await view.cdp.evaluate(`(()=>{document.querySelector('#toast').classList.remove('visible');const target=${focusSelector ? 'document.querySelector(' + JSON.stringify(focusSelector) + ')' : 'null'};window.scrollTo(0,target ? Math.max(0,target.getBoundingClientRect().top + scrollY - innerHeight * .55) : 0);return true;})()`);
  const directory = process.env.MAIL_AI_ARTIFACTS || join(prototype,'assets','screenshots');
  await mkdir(directory,{ recursive: true });
  const { data } = await view.send('Page.captureScreenshot',{ format: 'png', captureBeyondViewport: false });
  await writeFile(join(directory,name + '.png'),Buffer.from(data,'base64'));
}
export async function assertClean(f) {
  assert.deepEqual(f.errors,[],'No unhandled page errors');
  assert.deepEqual(f.requests.filter(r=>r.status !== 200),[],'All local assets load');
  assert.deepEqual(f.externalRequests,[],'Prototype makes no external requests');
  assert.deepEqual(f.view.cdp.console({ limit: 100 }).messages.filter(m=>m.type === 'error'),[],'No console or CSP errors');
  assert.equal(await f.view.cdp.evaluate('localStorage.length + sessionStorage.length'),0,'No credentials or mail persisted in browser storage');
}
