// 极简 CDP 驱动：启动无头 Chrome，打开原型，提供 eval/click/截图。仅用于设计原型验证。
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1440, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), "belfry-inbox-cdp-"));
  const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"],
    { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = ""; const t = setTimeout(() => reject(new Error("chrome start timeout")), 15000);
    proc.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(t); resolve(m[1]); } });
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const waiters = new Map(); const errors = [];
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiters.has(msg.id)) { const w = waiters.get(msg.id); waiters.delete(msg.id); msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
    if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; waiters.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const page$ = {
    errors, send,
    async viewport(w, h) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }); await sleep(150); },
    async goto(url) { await send("Page.navigate", { url }); for (let i = 0; i < 100; i++) { await sleep(100); if (await page$.eval("window.__prototypeReady === true").catch(() => false)) return; } throw new Error("page not ready"); },
    async eval(expr) { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; },
    // 真实鼠标点击：取元素中心坐标，派发 mousePressed/Released，并确认命中的是目标本身
    async click(selector) {
      const box = await page$.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:"nearest",inline:"nearest"}); const r = el.getBoundingClientRect(); const x = r.left + r.width/2, y = r.top + r.height/2; const hit = document.elementFromPoint(x, y); return { x, y, w: r.width, h: r.height, ok: !!hit && (hit === el || el.contains(hit)), disabled: !!el.disabled }; })()`);
      if (!box) throw new Error(`not found: ${selector}`);
      if (!box.ok || box.w === 0) throw new Error(`not clickable (covered/hidden): ${selector}`);
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
      await sleep(120); return box;
    },
    async type(text) { await send("Input.insertText", { text }); await sleep(80); },
    async key(key, code = key, modifiers = 0) { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key, code, modifiers, windowsVirtualKeyCode: key === "Escape" ? 27 : key === "Enter" ? 13 : 0 }); await sleep(100); },
    async shot(path, full = false) { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full }); writeFileSync(path, Buffer.from(r.data, "base64")); },
    async close() { try { ws.close(); } catch {} proc.kill("SIGKILL"); await sleep(200); rmSync(profile, { recursive: true, force: true }); },
  };
  return page$;
}
export { sleep };
