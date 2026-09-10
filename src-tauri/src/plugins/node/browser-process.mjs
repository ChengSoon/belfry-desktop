import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { apiError } from "./errors.mjs";
import { detachedGroup, terminate } from "./process-tree.mjs";
import { BrowserClipboard } from "./browser-clipboard.mjs";

const MESSAGE_BYTES = 16 * 1024 * 1024, REQUEST_TIMEOUT = 20_000;
export async function browserExecutable() {
  if (process.env.BELFRY_BROWSER_EXECUTABLE && !isAbsolute(process.env.BELFRY_BROWSER_EXECUTABLE)) throw apiError("INVALID_ARGUMENT", "浏览器执行文件必须使用绝对路径");
  const windows = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean);
  const candidates = [process.env.BELFRY_BROWSER_EXECUTABLE,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge",
    ...windows.flatMap((root) => [join(root, "Microsoft/Edge/Application/msedge.exe"), join(root, "Google/Chrome/Application/chrome.exe")])].filter(Boolean);
  for (const path of candidates) if (await access(path, constants.X_OK).then(() => true, () => false)) return path;
  throw apiError("UNAVAILABLE", "浏览器插件需要 Chrome、Chromium 或 Edge，请安装其中一个浏览器后重试");
}
function environment() {
  return Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}
export class BrowserProcess extends EventEmitter {
  constructor(base) {
    super(); this.base = base; this.pending = new Map(); this.buffer = Buffer.alloc(0); this.next = 0; this.ended = false;
    this.clipboard = new BrowserClipboard(this);
  }
  async start() {
    const executable = await browserExecutable();
    await mkdir(this.base, { recursive: true });
    this.profile = await mkdtemp(join(this.base, "guest-"));
    this.child = spawn(executable, ["--headless=new", "--remote-debugging-pipe", "--no-startup-window", `--user-data-dir=${this.profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update",
      "--disable-sync", "--metrics-recording-only", "--password-store=basic", "--use-mock-keychain"],
    { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: environment(), detached: detachedGroup, windowsHide: true });
    this.child.stderr.on("data", () => {});
    this.child.stdio[4].on("data", (bytes) => this.receive(bytes));
    this.child.stdio[3].on("error", () => this.fail(apiError("BROWSER_CLOSED", "浏览器连接已关闭")));
    this.exited = new Promise((resolve) => {
      this.child.once("error", (error) => { this.fail(error); resolve(); });
      this.child.once("exit", () => { this.fail(apiError("BROWSER_CLOSED", "浏览器实例已退出")); resolve(); });
    });
    try { await this.send("Browser.getVersion"); return this; }
    catch (error) { await this.close(); throw error; }
  }
  receive(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > MESSAGE_BYTES) { this.fail(apiError("LIMIT_EXCEEDED", "浏览器消息超过限制")); terminate(this.child); return; }
    let end;
    while ((end = this.buffer.indexOf(0)) !== -1) {
      const source = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
      let message; try { message = JSON.parse(source.toString("utf8")); } catch { continue; }
      if (message.id) {
        const pending = this.pending.get(message.id); if (!pending) continue;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(apiError("BROWSER_ERROR", String(message.error.message).slice(0, 2048)));
        else pending.resolve(message.result);
      } else this.emit("protocol", message);
    }
  }
  send(method, params = {}, sessionId) {
    if (this.ended) return Promise.reject(apiError("BROWSER_CLOSED", "浏览器实例已关闭"));
    if (this.pending.size >= 128) return Promise.reject(apiError("BUSY", "浏览器请求过多"));
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => { this.pending.delete(id); reject(apiError("TIMEOUT", `浏览器 ${method} 超时`)); }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
    });
  }
  fail(error) {
    if (this.ended) return;
    this.ended = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.emit("closed");
  }
  close() { this.closing ??= this.shutdown(); return this.closing; }
  async shutdown() {
    if (!this.child) return;
    const clipboardClosed = this.clipboard.close();
    const stop = (signal) => { if (this.child.exitCode === null && this.child.signalCode === null) terminate(this.child, signal); };
    stop("SIGTERM");
    const timer = setTimeout(() => stop("SIGKILL"), 1000);
    await this.exited; clearTimeout(timer); await clipboardClosed;
    if (this.profile) await rm(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}
