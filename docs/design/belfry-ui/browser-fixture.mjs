// Isolated Chrome fixture for the design prototype; no Vite, Tauri or user data.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BrowserProcess } from '../../../src-tauri/src/plugins/node/browser-process.mjs';
import { BrowserTarget } from '../../../src-tauri/src/plugins/node/browser-target.mjs';

const project = fileURLToPath(new URL('../../../', import.meta.url));
const prototype = resolve(project, 'docs/design/belfry-ui');
const fontRoot = resolve(project, 'public/fonts');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2' };

export async function fixture(t) {
  const root = await mkdtemp(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), 'belfry-ui-browser-'));
  let server, browser, view;
  const requests = [], errors = [];
  t.after(async () => {
    if (view) await view.close();
    if (browser) await browser.close();
    if (server) await new Promise(done => { server.close(done); server.closeAllConnections(); });
    await rm(root, { recursive: true, force: true });
  });
  server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const path = resolve(project, '.' + pathname);
    const allowed = path.startsWith(prototype + sep) || path.startsWith(fontRoot + sep);
    const record = { path: pathname, status: null }; requests.push(record);
    try {
      if (!allowed || !mime[extname(path)]) throw new Error('Not allowed');
      const body = await readFile(path); record.status = 200;
      response.writeHead(200, { 'Content-Type': mime[extname(path)], 'Cache-Control': 'no-store' }); response.end(body);
    } catch {
      record.status = 404; response.writeHead(404); response.end('Not found');
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  browser = await new BrowserProcess(join(root, 'chrome')).start();
  view = await new BrowserTarget(browser, { workspace: root, frame() {}, state() {} }).start();
  browser.on('protocol', message => {
    if (message.sessionId !== view.sessionId) return;
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  });
  await view.bounds({ x: 0, y: 0, width: 1440, height: 960 });
  const url = `http://127.0.0.1:${server.address().port}/docs/design/belfry-ui/index.html`;
  await view.navigate({ url });
  await wait(view, 'document.readyState === "complete" && !!document.querySelector("main")');
  await view.cdp.evaluate('document.fonts.ready.then(()=>true)');
  return { view, requests, errors, url };
}

export async function wait(view, expression) {
  await view.cdp.evaluate(`new Promise((resolve,reject)=>{
    const end=Date.now()+7000;
    const poll=()=>{try{if(${expression}){resolve(true);return;}}catch{};
      if(Date.now()>end){reject(new Error('Timed out: '+${JSON.stringify(expression)}));return;}setTimeout(poll,20);};poll();
  })`);
}
export async function click(view, selector) {
  const point = await view.cdp.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;
    if(e.disabled)throw new Error('Disabled control');
    e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};
  })()`);
  assert.ok(point && point.width > 0 && point.height > 0, `No visible target: ${selector}`);
  await new Promise(r => setTimeout(r, 80));
  // Re-measure after scrolling/transitions before sending a trusted pointer event.
  const stable = await view.cdp.evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await view.send('Input.dispatchMouseEvent', { type, ...stable, button: 'left', clickCount: 1 });
}
export async function fill(view, selector, value) {
  await view.cdp.evaluate(`(()=>{
    const e=document.querySelector(${JSON.stringify(selector)}); if(!e)throw new Error('Missing field');
    e.focus();const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value')?.set;
    if(setter)setter.call(e,${JSON.stringify(value)});else e.value=${JSON.stringify(value)};
    e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true;
  })()`);
}
export async function press(view, key, modifiers = 0) {
  const codes = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, k: 75 };
  for (const type of ['keyDown', 'keyUp']) await view.send('Input.dispatchKeyEvent', {
    type, key, code: key === 'k' ? 'KeyK' : key, windowsVirtualKeyCode: codes[key], modifiers,
    ...(type === 'keyDown' && key === 'Enter' ? {text:'\r',unmodifiedText:'\r'} : {}),
  });
}
export async function screenshot(view, name) {
  await wait(view, '!document.querySelector("#toast.visible")');
  await new Promise(resolve => setTimeout(resolve, 250));
  const directory = process.env.BELFRY_UI_ARTIFACTS;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const { data } = await view.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, name + '.png'), Buffer.from(data, 'base64'));
}
export async function assertClean({ view, requests, errors }) {
  assert.deepEqual(errors, [], 'No unhandled browser exceptions');
  assert.deepEqual(requests.filter(r => r.status !== 200), [], 'All prototype/local-font resources load');
  assert.deepEqual(view.cdp.console({ limit: 100 }).messages.filter(m => m.type === 'error'), [], 'No console errors');
  assert.equal(await view.cdp.evaluate('Object.keys(localStorage).some(k=>/key|secret|token|provider/i.test(k))'), false, 'No secret persistence');
}
