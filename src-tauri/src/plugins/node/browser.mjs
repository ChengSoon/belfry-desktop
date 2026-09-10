import { join } from "node:path";
import { BrowserProcess } from "./browser-process.mjs";
import { BrowserTarget } from "./browser-target.mjs";
import { apiError, permission } from "./errors.mjs";
import { browserInput } from "./browser-input.mjs";
import { activeContext } from "./execution.mjs";

function connection(context) { return context.agentConnectionId ?? context.sessionId ?? context.workspace ?? "no-workspace"; }
function key(entry, context) { return `${entry.manifest.id}:${connection(context)}`; }
export class PluginBrowser {
  constructor({ base, context, platform }) {
    this.base = base; this.context = context; this.platform = platform; this.targets = new Map(); this.surfaces = new Map(); this.entries = new Map();
  }
  startEngine() {
    if (this.starting) return this.starting;
    const engine = new BrowserProcess(join(this.base, "browser")); this.engine = engine;
    engine.once("closed", () => {
      if (this.engine === engine) { this.starting = null; this.engine = null; }
      void this.remove((record) => record.process === engine);
      for (const entry of this.entries.values()) {
        entry.panel?.emit("__host:browserFrame", [null]); entry.panel?.emit("browser:state", [null]);
      }
      void engine.close().catch(() => {});
    });
    this.starting = engine.start().catch((error) => {
      if (this.engine === engine) { this.starting = null; this.engine = null; }
      throw error;
    });
    return this.starting;
  }
  async create(entry, context, record) {
    if (this.closing) throw apiError("BROWSER_CLOSED", "浏览器宿主正在关闭");
    const process = await this.startEngine(); record.process = process;
    const active = () => !context.expired && key(entry, context) === key(entry, this.context());
    const emit = (name, value) => { if (active()) entry.panel?.emit(name, [value]); };
    const target = new BrowserTarget(process, { workspace: context.workspace, frame: (value) => emit("__host:browserFrame", value), state: (value) => emit("browser:state", value),
      active: () => active() && !entry.abort.signal.aborted,
      pickFiles: (options) => this.platform({ api: "browser.pickFiles", pluginId: entry.manifest.id, args: [options] }),
      writeClipboard: (text) => this.platform({ api: "clipboard.writeText", pluginId: entry.manifest.id, args: [text] }),
      reportError: (error) => { void this.platform({ api: "ui.showToast", pluginId: entry.manifest.id, args: [error.message, "error"] }).catch(() => {}); } });
    await target.start();
    if (entry.abort.signal.aborted || context.expired || this.closing) { await target.close(); throw apiError("SESSION_EXPIRED", "浏览器会话已结束"); }
    const surface = this.surfaces.get(entry.manifest.id);
    if (surface?.bounds) await target.bounds(surface.bounds);
    if (surface?.visible && active()) await target.visibility(true);
    return target;
  }
  async target(entry, context) {
    const id = key(entry, context);
    if (!this.targets.has(id)) {
      if (this.targets.size >= 8) throw apiError("LIMIT_EXCEEDED", "浏览器会话过多，请先关闭不使用的 Agent 会话");
      const record = { pluginId: entry.manifest.id, connection: connection(context) };
      this.targets.set(id, record);
      record.promise = this.create(entry, context, record).catch((error) => { if (this.targets.get(id) === record) this.targets.delete(id); throw error; });
    }
    return this.targets.get(id).promise;
  }
  async call(entry, { api, input }, context) {
    permission(entry, "browser.cdp");
    activeContext(context);
    this.entries.set(entry.manifest.id, entry);
    const surface = this.updateSurface(entry.manifest.id, { api, input });
    if (["browser.getState", "browser.setVisible"].includes(api) && !this.targets.has(key(entry, context))) return null;
    const target = await this.target(entry, context);
    const result = await browserAction(target, { api, input }, {
      visible: surface.visible && key(entry, context) === key(entry, this.context()),
      openExternal: async () => this.platform({ api: "shell.openExternal", pluginId: entry.manifest.id, args: [(await target.state()).url] }),
    });
    if (entry.abort.signal.aborted || context.expired) throw apiError("SESSION_EXPIRED", "浏览器会话已结束");
    activeContext(context);
    return result;
  }
  updateSurface(pluginId, { api, input }) {
    const surface = this.surfaces.get(pluginId) ?? {};
    if (api === "browser.setBounds" && [input?.x, input?.y, input?.width, input?.height].every(Number.isFinite)) surface.bounds = input;
    if (api === "browser.setVisible") surface.visible = typeof input === "boolean" ? input : input?.visible === true;
    this.surfaces.set(pluginId, surface);
    return surface;
  }
  async remove(matches) {
    const closed = [];
    for (const [id, entry] of this.targets) if (matches(entry)) {
      this.targets.delete(id); closed.push(entry.promise.then((target) => target.close()).catch(() => {}));
    }
    await Promise.all(closed);
  }
  forget(pluginId) { this.surfaces.delete(pluginId); this.entries.delete(pluginId); return this.remove((entry) => entry.pluginId === pluginId); }
  revoke(sessionId) { return this.remove((entry) => entry.connection === sessionId); }
  async changed() {
    const current = connection(this.context());
    for (const entry of this.entries.values()) {
      entry.panel?.emit("__host:browserFrame", [null]);
      const target = await this.targets.get(key(entry, this.context()))?.promise.catch(() => null);
      entry.panel?.emit("browser:state", [target ? await target.state().catch(() => null) : null]);
    }
    for (const entry of this.targets.values()) {
      const target = await entry.promise.catch(() => null);
      if (target) await target.visibility(entry.connection === current && this.surfaces.get(entry.pluginId)?.visible === true).catch(() => {});
    }
  }
  async close() {
    this.closing = true;
    await this.remove(() => true);
    const process = await this.starting?.catch(() => null); if (process) await process.close();
    this.starting = null;
  }
}

function browserAction(target, { api, input }, { visible, openExternal }) {
  const handlers = {
    "browser.navigate": () => target.navigate(input), "browser.action": () => target.action(input),
    "browser.getState": () => target.state(), "browser.setBounds": () => target.bounds(input),
    "browser.setVisible": () => target.visibility(visible), "browser.snapshot": () => target.cdp.snapshot(),
    "browser.screenshot": () => target.cdp.screenshot(input), "browser.click": () => target.cdp.click(input),
    "browser.fill": () => target.cdp.fill(input), "browser.evaluate": () => target.cdp.evaluate(input?.expression),
    "browser.console": () => target.cdp.console(input), "browser.cdp": () => target.cdp.command(input),
    "browser.input": () => browserInput(target, input), "browser.openExternal": openExternal,
  };
  if (!Object.hasOwn(handlers, api)) throw apiError("UNSUPPORTED", api);
  return handlers[api]();
}
