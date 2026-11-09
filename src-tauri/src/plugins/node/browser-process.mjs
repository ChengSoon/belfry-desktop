import { access, mkdir, mkdtemp, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { apiError } from "./errors.mjs";
import { detachedGroup, terminate } from "./process-tree.mjs";
import { BrowserClipboard } from "./browser-clipboard.mjs";
import { BrowserDiagnostics, diagnosticError } from "./browser-diagnostics.mjs";

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
  constructor(base, { executable = browserExecutable, spawnChild = spawn } = {}) {
    super(); this.base = base; this.pending = new Map(); this.buffer = Buffer.alloc(0); this.next = 0; this.ended = false;
    this.executable = executable; this.spawnChild = spawnChild; this.diagnostics = new BrowserDiagnostics(REQUEST_TIMEOUT);
    this.profileState = "absent";
    this.clipboard = new BrowserClipboard(this);
  }
  async start() {
    this.diagnostics.record("browser.start");
    try {
      const executable = await this.executable();
      this.diagnostics.record("executable.selected");
      if (this.closing) throw apiError("BROWSER_CLOSED", "浏览器实例已关闭");
      await mkdir(this.base, { recursive: true });
      this.profile = await mkdtemp(join(this.base, "guest-")); this.profileState = "created";
      this.diagnostics.record("profile.created");
      if (this.closing) { await this.removeProfile(); throw apiError("BROWSER_CLOSED", "浏览器实例已关闭"); }
      this.child = this.spawnChild(executable, ["--headless=new", "--remote-debugging-pipe", "--no-startup-window", `--user-data-dir=${this.profile}`,
        "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-component-update",
        "--disable-sync", "--metrics-recording-only", "--password-store=basic", "--use-mock-keychain"],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: environment(), detached: detachedGroup, windowsHide: true });
      this.diagnostics.record("process.spawn", { pid: this.child.pid ?? null });
      this.child.once("spawn", () => this.diagnostics.record("process.spawned"));
      this.child.stderr.on("data", (bytes) => this.diagnostics.stderr(bytes));
      this.child.stderr.on("error", (error) => this.diagnostics.record("stderr.error", diagnosticError(error)));
      this.child.stdio[4].on("data", (bytes) => this.receive(bytes));
      for (const [index, name] of [[3, "write"], [4, "read"]]) {
        this.child.stdio[index].on("error", (error) => this.disconnected(`${name}.error`, error));
        this.child.stdio[index].once("close", () => this.disconnected(`${name}.close`));
      }
      this.child.stdio[4].once("end", () => this.disconnected("read.end"));
      this.exited = new Promise((resolve) => {
        this.child.once("error", (error) => { this.diagnostics.record("process.error", diagnosticError(error)); this.fail(error, "process.error"); resolve(); });
        this.child.once("exit", (code, signal) => {
          this.diagnostics.record("process.exit", { code, signal });
          this.fail(apiError("BROWSER_CLOSED", "浏览器实例已退出"), "process.exit"); resolve();
        });
      });
      this.pipesClosed = new Promise((resolve) => this.child.once("close", (code, signal) => {
        this.childClosed = true; this.diagnostics.finishStderr(); this.diagnostics.record("process.close", { code, signal }); resolve();
      }));
      await this.send("Browser.getVersion"); this.diagnostics.record("browser.ready"); return this;
    } catch (error) {
      this.reportFailure(error, "browser.start");
      try { await this.close(); } catch (cleanup) { this.diagnostics.record("cleanup.error", diagnosticError(cleanup)); }
      this.refreshDiagnostics(error); throw error;
    }
  }
  disconnected(event, cause) {
    this.diagnostics.record(event, cause ? diagnosticError(cause) : {});
    const error = apiError("BROWSER_CLOSED", "浏览器连接已关闭");
    if (cause) error.cause = cause;
    this.fail(error, event);
  }
  receive(bytes) {
    if (this.ended) return;
    this.buffer = Buffer.concat([this.buffer, bytes]);
    if (this.buffer.length > MESSAGE_BYTES) { this.fail(apiError("LIMIT_EXCEEDED", "浏览器消息超过限制"), "protocol.limit"); return; }
    let end;
    while ((end = this.buffer.indexOf(0)) !== -1) {
      const source = this.buffer.subarray(0, end); this.buffer = this.buffer.subarray(end + 1);
      let message; try { message = JSON.parse(source.toString("utf8")); } catch { this.diagnostics.record("protocol.invalid-json"); continue; }
      if (!message || typeof message !== "object") { this.diagnostics.record("protocol.invalid-message"); continue; }
      if (Number.isSafeInteger(message.id)) {
        const pending = this.pending.get(message.id);
        if (!pending) { this.diagnostics.record("response.unmatched", { id: message.id }); continue; }
        this.pending.delete(message.id); clearTimeout(pending.timer);
        this.diagnostics.record(message.error ? "response.error" : "response.ok", { ...pending.info,
          elapsedMs: this.diagnostics.now() - pending.sentAt,
          ...(message.error ? { protocolCode: Number.isInteger(message.error.code) ? message.error.code : null }
            : pending.info.method.startsWith("Target.") ? this.diagnostics.ids(message.result) : {}) });
        if (message.error) {
          const error = apiError("BROWSER_ERROR", String(message.error.message).slice(0, 2048));
          error.browserRequest = pending.info; pending.reject(error);
        } else pending.resolve(message.result);
      } else { this.diagnostics.protocol(message); this.emit("protocol", message); }
    }
  }
  send(method, params = {}, sessionId) {
    if (this.ended) return Promise.reject(apiError("BROWSER_CLOSED", "浏览器实例已关闭"));
    if (this.pending.size >= 128) return Promise.reject(apiError("BUSY", "浏览器请求过多"));
    return new Promise((resolve, reject) => {
      const id = ++this.next, info = { ...this.diagnostics.request(id, method, sessionId),
        ...(["Target.createTarget", "Target.attachToTarget", "Target.disposeBrowserContext"].includes(method) ? this.diagnostics.ids(params) : {}) };
      const frame = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0", sentAt = this.diagnostics.now();
      const timer = setTimeout(() => {
        this.pending.delete(id); this.diagnostics.record("request.timeout", { ...info, elapsedMs: this.diagnostics.now() - sentAt });
        const error = apiError("TIMEOUT", `浏览器 ${method} 超时`); error.browserRequest = info; reject(error);
      }, REQUEST_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer, info, sentAt });
      this.diagnostics.record("request.send", { ...info, timeoutMs: REQUEST_TIMEOUT });
      try {
        const writable = this.child.stdio[3].write(frame, (error) => {
          if (error) this.disconnected("write.error", error);
          else this.diagnostics.record("request.written", { id }); // Pipe handoff, not a protocol acknowledgement.
        });
        if (!writable) this.diagnostics.record("write.backpressure", { id });
      } catch (error) { this.disconnected("write.error", error); }
    });
  }
  diagnosticState() {
    const child = this.child;
    return { pid: child?.pid ?? null, exitCode: child?.exitCode ?? null, signalCode: child?.signalCode ?? null,
      ended: this.ended, closing: !!this.closing, childClosed: !!this.childClosed, profile: this.profileState,
      readEnded: child?.stdio[4]?.readableEnded ?? null, readDestroyed: child?.stdio[4]?.destroyed ?? null,
      writeDestroyed: child?.stdio[3]?.destroyed ?? null, bufferedBytes: this.buffer.length,
      pending: [...this.pending.values()].map((entry) => ({ ...entry.info, ageMs: this.diagnostics.now() - entry.sentAt })) };
  }
  reportFailure(error, phase) {
    this.failureError ??= error;
    this.diagnostics.firstFailure ??= { ms: this.diagnostics.now(), phase, ...diagnosticError(error),
      ...(error?.browserRequest ? { request: error.browserRequest } : {}), state: this.diagnosticState() };
    this.diagnostics.record("failure", { phase, ...diagnosticError(error) });
    this.refreshDiagnostics(error);
  }
  refreshDiagnostics(error = this.failureError) {
    if (!this.diagnostics.firstFailure) return;
    const snapshot = this.diagnostics.snapshot(this.diagnosticState());
    this.diagnostics.persist(snapshot);
    if (this.diagnostics.writeError) snapshot.artifactError = this.diagnostics.writeError;
    if (this.failureError && typeof this.failureError === "object") this.failureError.browserDiagnostics = snapshot;
    if (error && typeof error === "object") error.browserDiagnostics = snapshot;
  }
  fail(error, phase) {
    if (this.ended) return;
    if (!this.closing) this.reportFailure(error, phase);
    this.ended = true;
    this.diagnostics.record("requests.cancelled", { count: this.pending.size, ...diagnosticError(error) });
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.buffer = Buffer.alloc(0); this.emit("closed");
    if (!this.closing) void this.close().catch((cleanup) => {
      this.diagnostics.record("cleanup.error", diagnosticError(cleanup)); this.refreshDiagnostics();
    });
  }
  // Install the shared promise before shutdown emits "closed" (listeners may close again).
  close() { this.closing ??= Promise.resolve().then(() => this.shutdown()); return this.closing; }
  async shutdown() {
    this.diagnostics.record("cleanup.start");
    this.fail(apiError("BROWSER_CLOSED", "浏览器实例已关闭"), "close.cancel");
    const clipboardClosed = this.clipboard.close();
    if (this.child) {
      const stop = (signal) => { this.diagnostics.record("process.signal", { signal }); terminate(this.child, signal); };
      if (this.child.exitCode === null && this.child.signalCode === null) stop("SIGTERM");
      const timer = setTimeout(() => {
        // A child/descendant may still own a pipe after the browser's exit event.
        if (!this.childClosed) stop("SIGKILL");
        for (const pipe of this.child.stdio) pipe?.destroy();
        this.diagnostics.record("pipes.destroyed");
      }, 1000);
      try { await this.exited; await this.pipesClosed; } finally { clearTimeout(timer); }
    }
    await clipboardClosed; this.diagnostics.record("clipboard.closed");
    await this.removeProfile(); this.diagnostics.record("cleanup.complete"); this.refreshDiagnostics();
  }
  async removeProfile() {
    if (this.profile && this.profileState !== "removed") {
      await rm(this.profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      this.profileState = "removed"; this.diagnostics.record("profile.removed");
    }
  }
}
