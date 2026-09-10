import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { apiError, errorValue } from "./errors.mjs";
import { detachedGroup, terminate } from "./process-tree.mjs";
import { encodeMessage } from "./wire.mjs";

function cleanEnvironment() {
  return Object.fromEntries(["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "LANG"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}
export class PluginChild {
  constructor({ path, onHost, onExit, onLog }) {
    this.pending = new Map(); this.contexts = new Map(); this.closing = false;
    this.process = fork(fileURLToPath(new URL("./worker.mjs", import.meta.url)), [], {
      cwd: path, env: cleanEnvironment(), execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"], detached: detachedGroup, windowsHide: true,
    });
    this.onHost = onHost;
    this.onLog = onLog;
    this.process.on("message", (message) => this.receive(message));
    this.process.on("error", (error) => this.fail(error));
    this.exited = new Promise((resolve) => this.process.once("exit", (code) => {
      if (detachedGroup) terminate(this.process, "SIGKILL");
      this.fail(apiError("PLUGIN_EXITED", `插件进程已退出（${code}）`));
      if (!this.closing) onExit(code);
      resolve();
    }));
    let logBytes = 0;
    const log = (chunk) => { if (logBytes < 64 * 1024) { logBytes += chunk.length; onLog(String(chunk).slice(0, 4096)); } };
    this.process.stdout.on("data", log); this.process.stderr.on("data", log);
  }
  fail(error) {
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.cleanup?.(); entry.reject(error); }
    this.pending.clear(); this.contexts.clear();
  }
  setPanelContext(context) {
    const previous = this.contexts.get(this.panelContextId);
    if (!previous || previous.workspace !== context.workspace || previous.sessionId !== context.sessionId) {
      if (this.panelContextId) this.contexts.delete(this.panelContextId);
      this.panelContextId = randomUUID();
    }
    this.contexts.set(this.panelContextId, context);
    return this.panelContextId;
  }
  receive(message) {
    if (!message || Buffer.byteLength(JSON.stringify(message)) > 1024 * 1024) { terminate(this.process); return; }
    if (message.type === "result") {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id); this.contexts.delete(message.id); clearTimeout(entry.timer); entry.cleanup?.();
      if (message.ok) entry.resolve(message.value);
      else entry.reject(Object.assign(new Error(message.error?.message), { code: message.error?.code }));
    } else if (message.type === "host") {
      const context = message.contextId && !this.contexts.has(message.contextId) ? { workspace: null, expired: true } : this.contexts.get(message.contextId);
      Promise.resolve().then(() => this.onHost(message.api, message.args ?? [], context))
        .then((value) => this.send({ type: "hostReply", id: message.id, ok: true, value: value ?? null }))
        .catch((error) => this.send({ type: "hostReply", id: message.id, ok: false, error: errorValue(error) }));
    } else if (message.type === "log") this.onLog(String(message.message).slice(0, 4096));
  }
  send(message) { encodeMessage(message); if (this.process.connected) this.process.send(message, () => {}); }
  invoke(method, params = {}, options = {}) {
    if (!this.process.connected) return Promise.reject(apiError("PLUGIN_EXITED", "插件进程不可用"));
    if (this.pending.size >= 128) return Promise.reject(apiError("LIMIT_EXCEEDED", "请求过多"));
    const signal = options.context?.abort?.signal;
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id); this.contexts.delete(id); cleanup();
        reject(apiError("TIMEOUT", `插件 ${method} 超时`));
        terminate(this.process);
      }, options.timeout ?? 15_000);
      const abort = () => {
        const error = signal.reason?.code ? signal.reason : apiError("CANCELLED", "插件调用已取消");
        this.contexts.delete(id); cleanup();
        this.send({ type: "abort", id, error: errorValue(error) }); reject(error);
      };
      const cleanup = () => signal?.removeEventListener("abort", abort);
      this.pending.set(id, { resolve, reject, timer, cleanup });
      const contextId = options.persistentContext ? this.setPanelContext(options.context) : options.context === undefined ? undefined : id;
      if (!options.persistentContext) this.contexts.set(id, options.context);
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ type: "invoke", id, contextId, method, params }); }
      catch (error) { this.pending.delete(id); this.contexts.delete(id); clearTimeout(timer); cleanup(); reject(error); }
    });
  }
  async stop() {
    this.closing = true;
    if (this.process.connected) await this.invoke("unload", {}, { timeout: 2000 }).catch(() => {});
    terminate(this.process);
    const timer = setTimeout(() => terminate(this.process, "SIGKILL"), 1000);
    await this.exited; clearTimeout(timer);
  }
}
