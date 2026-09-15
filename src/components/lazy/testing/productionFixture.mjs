import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { cleanupScope, temporary } from "../../../../scripts/plugin-tests/support.mjs";
import { BrowserProcess } from "../../../../src-tauri/src/plugins/node/browser-process.mjs";
import { BrowserTarget } from "../../../../src-tauri/src/plugins/node/browser-target.mjs";
import { click, waitFor } from "../../../../scripts/plugin-tests/market-ui-support.mjs";
export { click, press, waitFor } from "../../../../scripts/plugin-tests/market-ui-support.mjs";

/** 不启动 Vite、不转换模块、不禁用浏览器缓存。缺少生产构建直接失败。 */
export async function productionFixture(t, options = {}) {
  const files = await productionFiles(), requests = [];
  const lifetime = cleanupScope(t), root = await temporary(lifetime);
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const record = { url: request.url, pathname, status: null };
    requests.push(record);
    response.on("finish", () => { record.status = response.statusCode; });
    const serve = () => {
      const body = files.get(pathname);
      response.writeHead(body ? 200 : 404, { "Content-Type": mime(pathname) });
      response.end(body ?? "not found");
    };
    if (!options.handle?.(request, response, serve)) serve();
  });
  lifetime.after(() => new Promise((done) => { server.close(done); server.closeAllConnections(); }));
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const browser = await new BrowserProcess(join(root, "browser")).start();
  lifetime.after(() => browser.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const openWindow = () => openProductionWindow({ browser, lifetime, root, origin });
  const view = await openWindow();
  return { view, requests, origin, openWindow };
}

async function productionFiles() {
  const root = resolve("dist"), files = new Map();
  const html = await readFile(join(root, "index.html")).catch((error) => {
    throw new Error("生产浏览器回归需要 dist/index.html；请先执行 pnpm build。", { cause: error });
  });
  assert.match(html.toString(), /type="module"[^>]*src="[^\"]*assets\/index-[^\"]+\.js"/);
  files.set("/", html); files.set("/index.html", html);
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(`/${relative(root, path).split(sep).join("/")}`, await readFile(path));
  }
  return files;
}

async function openProductionWindow({ browser, lifetime, root, origin }) {
  const view = await new BrowserTarget(browser, { workspace: root, frame: () => {}, state: () => {} }).start();
  lifetime.after(() => view.close());
  await view.bounds({ x: 0, y: 0, width: 1080, height: 700 });
  const source = await readFile(new URL("./productionNative.js", import.meta.url), "utf8");
  await view.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await view.navigate({ url: origin });
  await waitFor(view, "document.querySelectorAll('.xterm').length === 1 && __productionQA.creates === 1");
  await view.cdp.evaluate(`__productionQA.terminals = [...document.querySelectorAll('.xterm')];
    __productionQA.input = document.querySelector('.xterm-helper-textarea');
    __productionQA.input.focus(); __productionQA.removed = 0;
    new MutationObserver(records => {
      for (const record of records) for (const node of record.removedNodes) {
        if (__productionQA.terminals.some(terminal => node === terminal || node.contains(terminal))) __productionQA.removed++;
      }
    }).observe(document.body, { childList: true, subtree: true });`);
  return view;
}

function mime(path) {
  if (path === "/") return "text/html";
  return ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".woff2": "font/woff2",
    ".woff": "font/woff", ".ttf": "font/ttf", ".png": "image/png", ".svg": "image/svg+xml" })[extname(path)] ?? "application/octet-stream";
}

export function failFirst(pattern) {
  let failed = false;
  return (request, response) => {
    if (failed || !pattern.test(request.url)) return false;
    failed = true;
    response.writeHead(503, { "Content-Type": "text/plain" }); response.end("test-only resource failure");
    return true;
  };
}

export async function assertTerminalIntact(view, token) {
  assert.deepEqual({ token, creates: 1, connected: true, removed: 0, detached: 0, errors: [] }, await view.cdp.evaluate(`({
    token: __productionQA.token, creates: __productionQA.creates,
    connected: __productionQA.terminals.every(el => el.isConnected) && __productionQA.input.isConnected,
    removed: __productionQA.removed,
    detached: __productionQA.calls.filter(call => /^(terminal_close|terminal_detach|terminal_close_tab)$/.test(call.command)).length,
    errors: __productionQA.errors,
  })`));
}

export async function assertTerminalInput(view) {
  await click(view, ".xterm-helper-textarea");
  await view.send("Input.insertText", { text: "terminal-still-accepts-input" });
  await waitFor(view, "__productionQA.writes.some(call => new TextDecoder().decode(new Uint8Array(call.bytes)).includes('terminal-still-accepts-input'))");
}
