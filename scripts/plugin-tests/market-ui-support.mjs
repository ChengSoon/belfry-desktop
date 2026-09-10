import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { cleanupScope, temporary } from "./support.mjs";
import { BrowserProcess } from "../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../src-tauri/src/plugins/node/browser-target.mjs";
import { PluginManagement } from "../../src-tauri/src/plugins/node/management.mjs";
import { PluginMarket } from "../../src-tauri/src/plugins/node/market.mjs";
import { administration } from "../../src-tauri/src/plugins/node/administration.mjs";
import { scaffold } from "../../src-tauri/src/plugins/node/author.mjs";

export const SOURCE_SELECT = 'select[aria-label="插件市场来源"]';
export const CUSTOM_INPUT = 'input[aria-label="目录地址"]';
const UI_TIMEOUT_MS = 10_000;
const REGISTRY = { format: "belfry-directory-plugins-v1", storeSchemaVersion: 1, revision: "0", plugins: [] };
const RUNTIME = { available: true, errors: {}, commands: [], tools: [], skills: [], views: [], themes: [], services: [], plugins: [], shortcuts: [] };

export async function marketUiFixture(t, settings) {
  const lifetime = cleanupScope(t), root = await temporary(lifetime);
  const management = await new PluginManagement(join(root, "data")).init();
  if (settings) await management.setSource(settings);
  const market = new PluginMarket({ base: join(root, "data"), management, installed: () => [] });
  const directory = join(root, "notes");
  await scaffold({ directory, template: "panel-basic", id: "mine.notes", name: "我的笔记", author: "Maker" });
  await market.personal.publish({ directory });
  const routes = new Map(), calls = [], manager = { management, market };
  const server = await createServer({ configFile: false, logLevel: "silent", cacheDir: join(root, "vite-cache"),
    plugins: [react(), { name: "market-page-test", configureServer: (vite) => {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== "/__market-rpc" && !routes.has(request.url)) { next(); return; }
        void respond({ request, response }, { manager, routes, calls }).catch((error) => {
          response.writeHead(500, { "Content-Type": "application/json" }); response.end(JSON.stringify({ error: error.message }));
        });
      });
    } }], server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  });
  lifetime.after(() => server.close());
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const engine = await new BrowserProcess(join(root, "chromium")).start(); lifetime.after(() => engine.close());
  const view = await new BrowserTarget(engine, { workspace: root, frame: () => {}, state: () => {} }).start();
  lifetime.after(() => view.close());
  const open = async () => {
    await view.navigate({ url: `${origin}/scripts/plugin-tests/fixtures/market-page.html` });
    await waitFor(view, '!!document.querySelector("#plugins-tab-market")');
    await click(view, "#plugins-tab-market");
    await waitFor(view, `!!document.querySelector(${JSON.stringify(SOURCE_SELECT)})`);
  };
  return { root, view, management, market, origin, routes, calls, open };
}

async function respond({ request, response }, { manager, routes, calls }) {
  if (routes.has(request.url)) {
    const { status = 200, body = {} } = routes.get(request.url);
    response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); return;
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const { command, args } = JSON.parse(body); calls.push({ command, args });
  const value = await dispatch(manager, command, args);
  response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ value }));
}

function dispatch(manager, command, args) {
  if (command === "plugins_list") return REGISTRY;
  if (command !== "plugins_runtime") throw new Error(`测试中未提供的原生命令：${command}`);
  if (args.method === "catalog") return RUNTIME;
  return administration(manager, args.method, args.params);
}

export async function waitFor(view, expression) {
  try {
    return await view.cdp.evaluate(`new Promise((resolve,reject)=>{
      const deadline=Date.now()+${UI_TIMEOUT_MS};
      const check=()=>{if(${expression})resolve(true);else if(Date.now()>deadline)reject(new Error('等待页面状态超时'));else setTimeout(check,20)};
      check();
    })`);
  } catch (error) { throw new Error(`${error.message}\n${expression}\n${(await view.cdp.snapshot()).tree}`); }
}

export async function click(view, selector) {
  const point = await view.cdp.evaluate(`(()=>{
    const element=document.querySelector(${JSON.stringify(selector)}); if(!element)return null;
    element.scrollIntoView({block:'center'}); const rect=element.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  assert.ok(point, `缺少页面元素 ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await view.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
  }
}

export async function fill(view, selector, value) {
  await view.cdp.evaluate(`(()=>{
    const input=document.querySelector(${JSON.stringify(selector)}); input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
    input.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}

export async function selectSource(view, value) {
  await view.cdp.evaluate(`(()=>{
    const select=document.querySelector(${JSON.stringify(SOURCE_SELECT)});
    if(select.disabled)throw new Error('市场来源仍被禁用');
    select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true}));
  })()`);
}

export async function enter(view) {
  for (const type of ["keyDown", "keyUp"]) await view.send("Input.dispatchKeyEvent", {
    type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r", unmodifiedText: "\r" } : {}),
  });
}

export async function pageState(view) {
  return view.cdp.evaluate(`({
    source:document.querySelector(${JSON.stringify(SOURCE_SELECT)})?.value,
    disabled:document.querySelector(${JSON.stringify(SOURCE_SELECT)})?.disabled,
    cards:[...document.querySelectorAll('.plugins-card-name')].map(element=>element.textContent),
    errors:[...document.querySelectorAll('[role=alert]')].map(element=>element.textContent),
    sourceUrl:document.querySelector('.plugins-source-foot')?.textContent??''
  })`);
}

export async function screenshot(view, name) {
  const output = process.env.BELFRY_MARKET_UI_ARTIFACTS;
  if (!output) return;
  await mkdir(output, { recursive: true });
  const { data } = await view.send("Page.captureScreenshot", { format: "png" });
  await writeFile(join(output, `${name}.png`), Buffer.from(data, "base64"));
}
