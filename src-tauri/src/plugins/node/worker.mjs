import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire, Module } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildApi } from "./worker-api.mjs";
import { apiError, errorValue } from "./errors.mjs";
import { encodeMessage } from "./wire.mjs";

const context = new AsyncLocalStorage();
const pending = new Map();
const invocations = new Map();
const handlers = { commands: new Map(), tools: new Map(), services: new Map(), events: new Map(), bus: new Map(), registrations: [] };
let nextId = 0, pluginModule;
function send(message) { encodeMessage(message); if (process.connected) process.send(message, () => {}); }
function call(api, args) {
  return new Promise((resolve, reject) => {
    invocations.get(context.getStore())?.signal.throwIfAborted();
    if (pending.size >= 128) return reject(apiError("LIMIT_EXCEEDED", "插件请求过多"));
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(apiError("TIMEOUT", api)); }, api === "agent.complete" ? 95_000 : 60_000);
    pending.set(id, { resolve, reject, timer });
    try { send({ type: "host", id, api, args, contextId: context.getStore() }); }
    catch (error) { pending.delete(id); clearTimeout(timer); reject(error); }
  });
}
async function loadModule(entry) {
  const source = await readFile(entry, "utf8");
  if (entry.endsWith(".mjs") || /^\s*(?:import\s|export\s)/m.test(source)) {
    const module = await import(pathToFileURL(entry).href);
    return module.default ?? module;
  }
  const module = new Module(entry);
  module.filename = entry;
  module.paths = Module._nodeModulePaths(dirname(entry));
  module.require = createRequire(entry);
  module._compile(source, entry);
  return module.exports;
}
async function invoke(method, params, signal) {
  if (method === "init") return initialize(params);
  if (method === "unload") { await pluginModule?.onUnload?.(); return null; }
  if (method === "command") {
    const run = handlers.commands.get(params.id);
    if (!run) throw apiError("NOT_FOUND", "命令已撤销");
    return await run();
  }
  if (method === "tool") {
    const execute = handlers.tools.get(params.name);
    if (!execute) throw apiError("NOT_FOUND", "工具已撤销");
    return await execute(params.args, { ...params.context, signal, log: (message) => send({ type: "log", message: String(message).slice(0, 4096) }) });
  }
  if (method === "service") return invokeService(params);
  if (method === "panel.invoke") {
    if (!pluginModule?.onPanelInvoke) throw apiError("UNSUPPORTED", "插件未实现面板消息处理");
    return await pluginModule.onPanelInvoke(params.channel, params.payload);
  }
  throw apiError("UNSUPPORTED", method);
}
async function invokeService(params) {
  const service = handlers.services.get(params.id);
  if (!service) throw apiError("NOT_FOUND", "服务不存在");
  return await service[params.action]?.({ log: (message) => send({ type: "log", message: String(message) }) });
}
async function initialize(params) {
  globalThis.pi = buildApi({ manifest: params.manifest, call, handlers });
  pluginModule = await loadModule(join(params.path, params.manifest.main));
  await pluginModule.onLoad?.();
  await Promise.all(handlers.registrations);
  return { pid: process.pid };
}
function receive(message) {
  if (message.type === "hostReply") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id); clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  } else if (message.type === "invoke") {
    const controller = new AbortController(); invocations.set(message.id, controller);
    context.run(message.contextId, () => Promise.resolve().then(() => invoke(message.method, message.params, controller.signal))
      .then((value) => send({ type: "result", id: message.id, ok: true, value: value ?? null }))
      .catch((error) => send({ type: "result", id: message.id, ok: false, error: errorValue(error) }))
      .finally(() => invocations.delete(message.id)));
  } else if (message.type === "abort") {
    invocations.get(message.id)?.abort(Object.assign(new Error(message.error.message), { code: message.error.code }));
  } else if (message.type === "event") {
    const listeners = message.name === "bus" ? [handlers.bus.get(message.subscriptionId)] : [...(handlers.events.get(message.name) ?? [])];
    for (const listener of listeners) Promise.resolve().then(() => listener?.(...message.args)).catch((error) => console.error(error));
  }
}
process.on("message", receive);
process.on("disconnect", () => {
  if (process.platform !== "win32") { try { process.kill(-process.pid, "SIGTERM"); } catch { /* 已退出。 */ } }
  process.exit(0);
});
