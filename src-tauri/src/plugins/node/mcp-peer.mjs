import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { apiError } from "./errors.mjs";
import { resourcePath } from "./manifest.mjs";
import { McpHttp } from "./mcp-http.mjs";
import { validateCatalog } from "./mcp-validation.mjs";
import { detachedGroup, terminate } from "./process-tree.mjs";

const RPC_TIMEOUT = 20_000, MESSAGE_LIMIT = 512 * 1024;
function values(input, settings) {
  return Object.fromEntries(Object.entries(input ?? {}).map(([key, value]) => [key, typeof value === "string" ? value : String(settings[value.setting] ?? "")]));
}
export class McpPeer {
  constructor({ entry, descriptor, settings, log, exited, changed }) {
    this.entry = entry; this.descriptor = descriptor; this.log = log; this.exited = exited;
    this.pending = new Map(); this.nextId = 0; this.stopping = false; this.abort = new AbortController();
    this.changed = changed; this.active = false; this.catalog = { tools: [], prompts: [], resources: [], resourceTemplates: [] };
    if (descriptor.transport === "stdio") this.spawn(settings);
    else this.http = new McpHttp(this, values(descriptor.headers, settings));
  }
  spawn(settings) {
    const descriptor = this.descriptor;
    const command = descriptor.command === "node" ? process.execPath : /[\\/]/.test(descriptor.command) ? join(this.entry.path, resourcePath(descriptor.command)) : descriptor.command;
    const env = Object.fromEntries(["PATH", "SystemRoot", "windir", "TEMP", "TMP", "TMPDIR", "LANG"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
    this.process = spawn(command, descriptor.args ?? [], { cwd: this.entry.path, env: { ...env, ...values(descriptor.env, settings) }, stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: detachedGroup });
    this.process.on("error", (error) => this.fail(error));
    this.process.stdin.on("error", (error) => this.fail(error));
    let logged = 0;
    this.process.stderr.on("data", (chunk) => { if (logged < 64 * 1024) { logged += chunk.length; this.log(String(chunk).slice(0, 4096)); } });
    createInterface({ input: this.process.stdout }).on("line", (line) => this.receive(line));
    this.closed = new Promise((resolve) => this.process.once("close", (code) => {
      if (detachedGroup) terminate(this.process, "SIGKILL");
      this.fail(apiError("MCP_EXITED", `MCP ${descriptor.id} 已退出（${code}）`));
      if (!this.stopping) this.exited(); resolve();
    }));
  }
  receive(line) {
    try {
      if (Buffer.byteLength(line) > MESSAGE_LIMIT) throw apiError("LIMIT_EXCEEDED", "MCP 消息过大");
      const message = JSON.parse(line);
      if (message.method) { this.notice(message); return; }
      if (message.jsonrpc !== "2.0" || !("result" in message || "error" in message)) throw apiError("MCP_ERROR", "MCP 响应格式无效");
      const error = message.error ? Object.assign(apiError("MCP_ERROR", message.error.message), { rpcCode: message.error.code }) : null;
      this.settle(message.id, { error, value: message.result });
    } catch (error) { this.fail(error); terminate(this.process); }
  }
  notice(message) {
    if (typeof message.method !== "string" || !/^notifications\/(tools|prompts|resources)\/list_changed$/.test(message.method)) return;
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => { if (!this.stopping) this.changed?.(); }, 100);
  }
  async start() {
    this.initialized = await this.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "belfry-plugin-host", version: "1.0.0" } });
    await this.notify("notifications/initialized");
    await this.refreshCatalog();
    this.active = true;
    this.http?.watch();
    return this.catalog.tools;
  }
  async list(method, field) {
    const items = [], seen = new Set(); let cursor;
    do {
      const result = await this.call(method, cursor ? { cursor } : {});
      if (!Array.isArray(result?.[field]) || items.length + result[field].length > 500) throw apiError("INVALID_ARGUMENT", "MCP 贡献目录无效或超额");
      items.push(...result[field]); cursor = result.nextCursor;
      if (cursor && (typeof cursor !== "string" || cursor.length > 1024 || seen.has(cursor) || seen.size >= 20)) throw apiError("INVALID_ARGUMENT", "MCP 分页游标无效");
      seen.add(cursor);
    } while (cursor);
    return items;
  }
  async refreshCatalog() {
    const capabilities = this.initialized?.capabilities ?? {}, catalog = {};
    for (const [group, method, capability] of [["tools", "tools/list", "tools"], ["prompts", "prompts/list", "prompts"],
      ["resources", "resources/list", "resources"], ["resourceTemplates", "resources/templates/list", "resources"]]) {
      catalog[group] = capabilities[capability] ? await this.list(method, group).catch((error) => {
        if (group === "resourceTemplates" && error.rpcCode === -32601) return [];
        throw error;
      }) : [];
    }
    this.catalog = validateCatalog(catalog);
  }
  settle(id, { error, value }) {
    const pending = this.pending.get(id); if (!pending) return;
    this.pending.delete(id); pending.cleanup();
    if (error) pending.reject(error); else pending.resolve(value);
  }
  call(method, params, options = {}) {
    const id = ++this.nextId, message = { jsonrpc: "2.0", id, method, params };
    if (this.stopping || this.entry.abort.signal.aborted || (this.process && this.process.exitCode !== null)) return Promise.reject(apiError("MCP_EXITED", "MCP 已停止"));
    if (this.pending.size >= 32) return Promise.reject(apiError("LIMIT_EXCEEDED", "MCP 请求过多"));
    const signals = [this.abort.signal, this.entry.abort.signal, AbortSignal.timeout(method === "tools/call" ? 100_000 : RPC_TIMEOUT)];
    if (options.signal) signals.push(options.signal);
    const signal = AbortSignal.any(signals);
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => {
        const error = signal.reason?.name === "TimeoutError" ? apiError("TIMEOUT", `MCP ${method} 超时`) : signal.reason;
        this.settle(id, { error });
        if (method === "tools/call" && !this.stopping) void this.notify("notifications/cancelled", { requestId: id }).catch(() => {});
      };
      this.pending.set(id, { resolve, reject, cleanup: () => signal.removeEventListener("abort", abort) });
      signal.addEventListener("abort", abort, { once: true });
      if (this.http) this.http.post(message, signal).then((value) => this.settle(id, { value }), (error) => this.settle(id, { error }));
      else this.process.stdin.write(JSON.stringify(message) + "\n");
    });
  }
  async notify(method, params) {
    const message = { jsonrpc: "2.0", method, params };
    if (this.http) await this.http.post(message, AbortSignal.any([this.abort.signal, this.entry.abort.signal, AbortSignal.timeout(RPC_TIMEOUT)]));
    else if (!this.stopping) this.process.stdin.write(JSON.stringify(message) + "\n");
  }
  fail(error) { for (const id of this.pending.keys()) this.settle(id, { error }); }
  async stop() {
    clearTimeout(this.changeTimer); this.active = false;
    this.stopping = true; this.abort.abort(apiError("PLUGIN_UNLOADED", "插件已停止")); this.fail(this.abort.signal.reason);
    if (this.http) return this.http.stop();
    this.process.stdin.end(); terminate(this.process);
    const timer = setTimeout(() => terminate(this.process, "SIGKILL"), 500);
    await this.closed; clearTimeout(timer);
  }
}
