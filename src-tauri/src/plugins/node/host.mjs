import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { PluginManager } from "./manager.mjs";
import { scaffold, check, pack } from "./author.mjs";
import { apiError, errorValue } from "./errors.mjs";
import { McpServer } from "./mcp-server.mjs";
import { administration } from "./administration.mjs";
import { recordDropped } from "./file-grants.mjs";
import { inScope } from "./management.mjs";
import { encodeMessage } from "./wire.mjs";

const pendingUi = new Map();
let nextUi = 0;
const send = (message) => process.stdout.write(encodeMessage(message) + "\n");
function platform(request) {
  return new Promise((resolveUi, reject) => {
    const id = `ui-${++nextUi}`;
    const timer = setTimeout(() => { pendingUi.delete(id); reject(apiError("TIMEOUT", request.api)); }, 60_000);
    pendingUi.set(id, { resolve: resolveUi, reject, timer });
    try { send({ type: "host", id, ...request }); }
    catch (error) { pendingUi.delete(id); clearTimeout(timer); reject(error); }
  });
}
let mcp;
const manager = new PluginManager({ base: resolve(process.argv[2]), platform,
  event: (name, payload) => { send({ type: "event", name, ...payload }); if (["catalogChanged", "error"].includes(name)) mcp?.changed(); } });
await manager.management.init();
mcp = await new McpServer(manager).start();
async function dispatch(method, params) {
  if (method.startsWith("clipboard.capture.")) return manager.broker.clipboard.capture(method.slice("clipboard.capture.".length), params);
  if (method.startsWith("management.") || method.startsWith("market.")) return administration(manager, method, params);
  const handlers = {
    hello: () => ({ nodeVersion: process.versions.node, pid: process.pid }),
    load: () => manager.load(params),
    unload: async () => { await manager.unload(params.pluginId); return null; },
    catalog: () => manager.catalog(manager.context, params),
    theme: () => manager.theme(params),
    command: () => manager.invoke(method, params), tool: () => manager.invoke(method, params),
    skill: () => manager.skill(params),
    panel: () => manager.broker.open(manager.get(params.pluginId), { viewId: params.viewId, options: params.options }),
    surface: () => {
      if (!params.viewId) throw apiError("INVALID_ARGUMENT", "嵌入视图缺少 ID");
      return manager.broker.surface(manager.get(params.pluginId), { viewId: params.viewId });
    },
    "surface.drop": () => dropFiles(params),
    "session.open": () => mcp.open(params),
    "session.revoke": () => { mcp.revoke(params.sessionId); return null; },
    context: async () => { await manager.setContext(params); return null; },
    "settings.get": () => manager.broker.call(manager.get(params.pluginId), { api: "plugin.getSettings", args: [] }),
    "settings.set": () => manager.broker.call(manager.get(params.pluginId), { api: "plugin.setSettings", args: [params.values] }),
    "author.scaffold": () => scaffold(params), "author.check": () => check(params.directory), "author.pack": () => pack(params),
    shutdown: async () => { await manager.close(); await mcp.close(); return null; },
  };
  if (!Object.hasOwn(handlers, method)) throw apiError("UNSUPPORTED", method);
  return handlers[method]();
}
async function dropFiles(params) {
  const entry = manager.get(params.pluginId);
  if (!inScope(entry.scope, manager.context.workspace)) throw apiError("PERMISSION_DENIED", "插件不在当前项目生效");
  const files = await recordDropped(entry, params.paths);
  entry.panel?.emit("__host:drop", [files, params.position], params.surfaceId ?? "panel");
  return null;
}
function receive(line) {
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("宿主消息超额");
    request = JSON.parse(line);
  } catch (error) { process.stderr.write(`${error.message}\n`); return; }
  if (request.type === "hostReply") {
    const entry = pendingUi.get(request.id);
    if (!entry) return;
    pendingUi.delete(request.id); clearTimeout(entry.timer);
    if (request.error) entry.reject(Object.assign(new Error(request.error.message), { code: request.error.code }));
    else entry.resolve(request.value);
    return;
  }
  Promise.resolve().then(() => dispatch(request.method, request.params ?? {}))
    .then((value) => send({ id: request.id, ok: true, value: value ?? null }))
    .catch((error) => send({ id: request.id, ok: false, error: errorValue(error) }));
}
createInterface({ input: process.stdin }).on("line", receive).on("close", async () => {
  await manager.close();
  await mcp.close();
  for (const entry of pendingUi.values()) { clearTimeout(entry.timer); entry.reject(apiError("PLUGIN_EXITED", "宿主已退出")); }
  pendingUi.clear();
});
