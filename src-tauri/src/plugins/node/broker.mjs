import { apiError, permission } from "./errors.mjs";
import { dataPath, getSettings, setSettings } from "./settings.mjs";
import { filesystem } from "./filesystem.mjs";
import { Extensions } from "./extensions.mjs";
import { PanelServer } from "./panel.mjs";
import { networkFetch } from "./network.mjs";
import { McpContributions } from "./mcp-contributions.mjs";
import { inScope } from "./management.mjs";
import { ClipboardTransfer } from "./clipboard-transfer.mjs";
import { PluginModels } from "./models.mjs";
import { PluginBrowser } from "./browser.mjs";
import { activeContext } from "./execution.mjs";

const PLATFORM_PERMISSIONS = {
  "ui.windowControl": "ui.panel", "shell.openExternal": "shell.openExternal",
  "ui.notify": "notify", "ui.getNotificationPermission": "notify",
  "ui.requestNotificationPermission": "notify", "ui.showNativeNotification": "notify",
};

export class Broker {
  constructor({ base, platform, event, context }) {
    this.base = base; this.platform = platform; this.event = event; this.context = context;
    this.commands = new Map(); this.tools = new Map();
    this.extensions = new Extensions(event);
    this.mcp = new McpContributions(this);
    this.clipboard = new ClipboardTransfer();
    this.models = new PluginModels(platform);
    this.browser = new PluginBrowser({ base, platform, context });
  }
  forget(id) {
    for (const map of [this.commands, this.tools]) for (const [key, item] of map) if (item.pluginId === id) map.delete(key);
    this.extensions.forget(id);
  }
  register(entry, api, args) {
    const tool = api.startsWith("agent.");
    if (tool) permission(entry, "agent.tool.register");
    const collection = tool ? this.tools : this.commands;
    const key = tool ? "name" : "id";
    const descriptor = args[0];
    const name = api.includes("unregister") ? String(descriptor) : descriptor?.[key];
    if (typeof name !== "string" || !name || name.length > 128) throw apiError("INVALID_ARGUMENT", "贡献 ID 无效");
    const fullKey = `${entry.manifest.id}:${name}`;
    if (api.includes("unregister")) { collection.delete(fullKey); return null; }
    checkContributionLimit(collection, fullKey, entry.manifest.id);
    if (entry.stopping) throw apiError("PLUGIN_UNLOADED", "插件正在停止");
    collection.set(fullKey, { ...descriptor, pluginId: entry.manifest.id, pluginName: entry.manifest.name });
    this.event("catalogChanged", { pluginId: entry.manifest.id });
    return null;
  }
  async call(entry, { api, args }, requestContext) {
    const context = requestContext ?? this.context();
    activeContext(context);
    validateRequest(entry, { api, args }, context);
    if (["commands.register", "commands.unregister", "agent.registerTool", "agent.unregisterTool"].includes(api)) return this.register(entry, api, args);
    const groups = {
      fs: () => filesystem({ entry, api, args, context, platform: this.platform }),
      browser: () => this.browser.call(entry, { api, input: args[0] }, context),
      services: () => this.extensions.service(entry, api, args),
      bus: () => this.extensions.bus(entry, api, args),
      plugin: () => this.pluginApi(entry, { api, args }),
      app: () => applicationValue(api, context),
      clipboard: () => this.clipboardApi(entry, { api, args }, context),
    };
    const namespace = api.split(".")[0];
    if (Object.hasOwn(groups, namespace)) return groups[namespace]();
    return this.miscellaneousApi(entry, { api, args }, context);
  }
  async pluginApi(entry, { api, args }) {
    const manifest = entry.manifest;
    switch (api) {
      case "plugin.getId": return manifest.id;
      case "plugin.getManifest": return manifest;
      case "plugin.getSettings": return getSettings(this.base, manifest);
      case "plugin.setSettings": {
        const values = await setSettings(this.base, manifest, args[0]);
        entry.settings = values;
        this.event("catalogChanged", { pluginId: manifest.id });
        entry.panel?.emit("settings:changed", [values]);
        entry.child?.send({ type: "event", name: "settings:changed", args: [values] });
        return values;
      }
      case "plugin.getDataPath": return dataPath(this.base, manifest.id);
    }
    throw apiError("UNSUPPORTED", `当前宿主不提供 ${api}`);
  }
  async clipboardApi(entry, { api, args }, context) {
    const pluginId = entry.manifest.id;
    if (["clipboard.getHistory", "clipboard.historyPage", "clipboard.imageChunk", "clipboard.releaseHistory"].includes(api)) {
      permission(entry, "clipboard.read");
      return this.clipboard.call(`${pluginId}:${context.sessionId ?? "ui"}`, api, args[0]);
    }
    if (api === "clipboard.readText") {
      permission(entry, "clipboard.read");
      const text = await this.platform({ api, pluginId, args: [] });
      this.clipboard.text(text);
      return text;
    }
    if (api === "clipboard.writeText") {
      permission(entry, "clipboard.write");
      await this.platform({ api, pluginId, args });
      return this.clipboard.text(args[0]);
    }
    throw apiError("UNSUPPORTED", `当前宿主不提供 ${api}`);
  }
  miscellaneousApi(entry, { api, args }, context) {
    const platform = () => this.platform({ api, pluginId: entry.manifest.id, args });
    const callbacks = {
      "models.list": () => this.models.list(entry, context),
      "session.getLlmContext": () => this.models.session(entry, context),
      "agent.complete": () => this.models.complete(entry, args[0], context),
      "workspace.get": () => context.workspace ? { path: context.workspace, name: context.workspace.split(/[\\/]/).pop() } : null,
      "ui.showToast": platform, "ui.closePanel": platform,
      "ui.openPanel": () => this.open(entry, { options: args[0] }, context),
      "net.fetch": () => networkFetch(entry, args[0]),
    };
    if (Object.hasOwn(callbacks, api)) return callbacks[api]();
    if (Object.hasOwn(PLATFORM_PERMISSIONS, api)) {
      permission(entry, PLATFORM_PERMISSIONS[api]); return platform();
    }
    throw apiError("UNSUPPORTED", `当前宿主不提供 ${api}`);
  }
  async open(entry, { viewId, options } = {}, context = this.context()) {
    const surface = await this.surface(entry, { viewId, options }, context);
    return this.platform({ api: "ui.openPanel", pluginId: entry.manifest.id, ...surface });
  }
  async surface(entry, { viewId, options } = {}, context = this.context()) {
    permission(entry, viewId ? "ui.view" : "ui.panel");
    if (!inScope(entry.scope, context.workspace)) throw apiError("PERMISSION_DENIED", "插件不在当前项目生效");
    if (entry.stopping) throw apiError("PLUGIN_UNLOADED", "插件正在停止");
    entry.panelStarting ??= new PanelServer({ entry, files: entry.files,
      call: (api, args) => this.call(entry, { api, args }),
      custom: (channel, payload) => entry.child.invoke("panel.invoke", { channel, payload }, { context: this.context(), persistentContext: true }) }).start();
    entry.panel = await entry.panelStarting;
    if (entry.stopping) { await entry.panel.close(); throw apiError("PLUGIN_UNLOADED", "插件正在停止"); }
    return entry.panel.surface(viewId, context, options);
  }
}

function checkContributionLimit(collection, key, pluginId) {
  if (collection.has(key)) return;
  const limit = 128, count = [...collection.values()].filter((item) => item.pluginId === pluginId).length;
  if (count >= limit) throw apiError("LIMIT_EXCEEDED", "插件注册的贡献过多");
}

function validateRequest(entry, { api, args }, context) {
  if (typeof api !== "string" || !Array.isArray(args)) throw apiError("INVALID_ARGUMENT", "API 请求无效");
  if (!inScope(entry.scope, context.workspace) && !/^(plugin\.|app\.|commands\.(un)?register|agent\.(un)?registerTool|services\.(un)?register)/.test(api)) throw apiError("PERMISSION_DENIED", "插件不在当前项目生效");
  if (!entry.stopping || api.startsWith("plugin.") || api.endsWith("unregister")) return;
  if (!["bus.unsubscribe", "ui.closePanel", "ui.showToast"].includes(api)) throw apiError("PLUGIN_UNLOADED", "插件正在停止");
}

function applicationValue(api, context) {
  const theme = context.theme ?? "dark", locale = context.locale ?? "zh-CN";
  const values = {
    "app.getVersion": context.appVersion ?? "0.19.0",
    "app.getLocale": locale,
    "app.getAppearance": context.appearance ?? { theme, base: theme, locale, pluginTheme: null },
  };
  if (!Object.hasOwn(values, api)) throw apiError("UNSUPPORTED", `当前宿主不提供 ${api}`);
  return values[api];
}
