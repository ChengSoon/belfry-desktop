import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadEngine, ENGINE_VERSION } from "./runtime.mjs";

export const EXTENSION_URL = "https://chromewebstore.google.com/detail/playwriter/jfeammnjpkecdekppnclgkkffahnhfhe";
export const DEFAULT_PORT = 19988;
const MAX_SESSIONS = 16;
const text = value => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
export const errorResult = error => ({ ...text(error.message || String(error)), isError: true });
const hint = `请先安装 Playwriter 浏览器扩展，保持 Chrome 打开，并在一个普通网页点击扩展图标使其变绿：${EXTENSION_URL}`;

function executionTimeout(args) {
  if (typeof args?.code !== "string" || !args.code.trim() || args.code.length > 50_000) throw new Error("code 需要 1–50000 个字符的 Playwright JavaScript。");
  const timeout = args.timeout ?? 10_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 60_000) throw new Error("timeout 必须是 1000–60000 毫秒的整数。");
  return timeout;
}
function executionResult(result) {
  const screenshots = (result.screenshots ?? []).map(image => `\n截图：${image.path}\n${image.snapshot ?? ""}`).join("\n");
  const content = [{ type: "text", text: (String(result.text || "操作完成。") + screenshots).slice(0, 20_000) }];
  let bytes = Buffer.byteLength(content[0].text);
  for (const image of result.images ?? []) {
    if (bytes + image.data.length > 750_000) {
      content[0].text += "\n图片超过工具传输上限，请截取较小区域或降低截图尺寸后重试。"; break;
    }
    bytes += image.data.length; content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  }
  return { content, ...(result.isError ? { isError: true } : {}) };
}
function scopeKey(scope) {
  if (!scope?.sessionId || !scope.workspace) throw new Error("需要有效的 Agent 会话和项目目录，请从 Belfry 项目中的 Agent 调用此工具。");
  return JSON.stringify([scope.workspace, scope.sessionId]);
}

class Controller {
  engine; starting; ownedRelay;
  phase = "idle"; lastError = ""; closed = false;
  shutdown = new AbortController(); sessions = new Map(); instanceId = randomUUID();
  logger = { log() {}, error: (...args) => { this.lastError = args.map(String).join(" ").slice(0, 1000); } };
  constructor({ dataPath, port = DEFAULT_PORT, engineLoader = loadEngine, fetchImpl = fetch }) {
    Object.assign(this, { dataPath, port, engineLoader, fetchImpl });
  }
  async request(path, timeout = 1200) {
    const response = await this.fetchImpl(`http://127.0.0.1:${this.port}${path}`, {
      signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(timeout)]), redirect: "error",
    });
    if (!response.ok) throw new Error(`浏览器连接服务返回 HTTP ${response.status}`);
    return response.json();
  }
  async probe() {
    try {
      const info = await this.request("/version");
      // Never kill or replace an existing process on the port.
      if (typeof info.version !== "string" || typeof info.instanceId !== "string") throw new Error("端口被其他服务占用");
      return info;
    } catch (error) {
      if (error.cause?.code === "ECONNREFUSED") return null;
      throw error;
    }
  }
  async startRelay() {
    if (await this.probe()) return;
    try {
      this.ownedRelay = await this.engine.startPlayWriterCDPRelayServer({ port: this.port, host: "127.0.0.1", logger: this.logger,
        cdpLogger: { log() {} } });
    } catch (error) {
      if (error.code !== "EADDRINUSE" || !await this.probe()) throw error;
    }
  }
  start() {
    if (this.closed) return Promise.reject(new Error("插件已停止"));
    if (this.starting) return this.starting;
    this.starting = (async () => {
      this.phase = "preparing"; this.lastError = "";
      this.engine ??= await this.engineLoader(await this.dataPath(), { signal: this.shutdown.signal });
      this.shutdown.signal.throwIfAborted();
      await this.startRelay();
      if (this.closed) { this.ownedRelay?.close(); this.ownedRelay = null; throw new Error("插件已停止"); }
      this.phase = "ready";
    })().catch(error => { if (!this.closed) { this.phase = "error"; this.lastError = error.message; } throw error; })
      .finally(() => { this.starting = null; });
    return this.starting;
  }
  async status() {
    let relay = null, extensions = [];
    if (this.phase === "ready") {
      try {
        relay = await this.probe();
        if (relay) extensions = (await this.request("/extensions/status")).extensions ?? [];
      } catch (error) { this.lastError = error.message; }
    }
    return { phase: this.phase, engineVersion: ENGINE_VERSION, relayRunning: Boolean(relay), relayVersion: relay?.version ?? null,
      ownedRelay: Boolean(this.ownedRelay), port: this.port, sessions: this.sessions.size, lastError: this.lastError,
      extensions: extensions.map(item => ({ id: item.extensionId, browser: item.browser ?? "Chromium",
        activeTabs: item.activeTargets ?? 0, version: item.playwriterVersion ?? null })), extensionUrl: EXTENSION_URL };
  }
  async ready() {
    if (this.phase !== "ready") await this.start();
    if (!await this.probe()) { this.phase = "idle"; this.ownedRelay = null; await this.start(); }
    const extensions = (await this.request("/extensions/status")).extensions ?? [];
    if (!extensions.length) throw new Error(hint);
    return extensions;
  }
  async session(scope) {
    const key = scopeKey(scope);
    if (this.sessions.has(key)) return this.sessions.get(key);
    const extensions = await this.ready();
    if (extensions.length > 1) throw new Error("检测到多个浏览器连接。请先断开暂时不用的 Playwriter 扩展，只保留需要操作的浏览器，再重试。");
    if (this.sessions.has(key)) return this.sessions.get(key);
    if (this.sessions.size >= MAX_SESSIONS) throw new Error("浏览器会话已达 16 个，请在不用的会话调用 playwriter_reset 后重试。");
    const id = createHash("sha256").update(this.instanceId).update(key).digest("hex").slice(0, 16);
    const executor = new this.engine.PlaywrightExecutor({ cwd: scope.workspace, logger: this.logger,
      cdpConfig: { host: "127.0.0.1", port: this.port, extensionId: extensions[0].extensionId,
        sessionId: `belfry-${id}`, tabGroup: `belfry-${id.slice(0, 5)}` } });
    const value = { executor, key };
    this.sessions.set(key, value);
    return value;
  }
  async execute(args, scope) {
    const timeout = executionTimeout(args);
    scope.signal?.throwIfAborted();
    const { executor } = await this.session(scope);
    scope.signal?.throwIfAborted();
    const signal = scope.signal ? AbortSignal.any([scope.signal, this.shutdown.signal]) : this.shutdown.signal;
    return executionResult(await executor.execute(args.code, { timeout, signal }));
  }
  async reset(scope) {
    const key = scopeKey(scope), value = this.sessions.get(key);
    if (value) { this.sessions.delete(key); await value.executor.dispose(); }
    return text("当前会话的浏览器连接和 state 已清空。浏览器标签页保留；下次执行时重新连接。");
  }
  async help() {
    if (!this.engine) await this.start();
    return text((await readFile(join(this.engine.root, "node_modules/playwriter/dist/prompt.md"), "utf8")).slice(0, 60_000));
  }
  async testConnection(workspace) {
    const scope = { sessionId: "__connection-test__", workspace };
    try {
      return await this.execute({ code: `const tab = await context.newPage(); try { await tab.setContent('<title>Belfry 连接测试</title><label>测试输入<input aria-label="测试输入"></label><button>验证</button><output></output><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent=document.querySelector("input").value<\/script>'); await tab.getByRole('textbox', { name: '测试输入' }).fill('Belfry 已连接'); await tab.getByRole('button', { name: '验证' }).click(); console.log(await tab.locator('output').textContent()); } finally { await tab.close(); }` }, scope);
    } finally { await this.reset(scope); }
  }
  async stop() {
    this.closed = true; this.phase = "stopped"; this.shutdown.abort(new Error("插件已停止"));
    const disposals = [...this.sessions.values()].map(value => value.executor.dispose()); this.sessions.clear();
    await Promise.allSettled(disposals);
    this.ownedRelay?.close(); this.ownedRelay = null;
  }
}
export function createController(options) { return new Controller(options); }
