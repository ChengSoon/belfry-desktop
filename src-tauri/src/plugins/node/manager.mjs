import { readDirectory } from "./directory.mjs";
import { PluginChild } from "./child.mjs";
import { Broker } from "./broker.mjs";
import { apiError } from "./errors.mjs";
import { isDeepStrictEqual } from "node:util";
import { staticContributions } from "./contributions.mjs";
import { Lifecycle } from "./lifecycle.mjs";
import { PluginManagement, inScope } from "./management.mjs";
import { PluginMarket } from "./market.mjs";
import { getSettings } from "./settings.mjs";
import { activeContext, invocationContext } from "./execution.mjs";

export class PluginManager {
  constructor({ base, platform, event }) {
    this.entries = new Map(); this.errors = new Map(); this.context = {};
    this.event = event;
    this.installed = [];
    this.management = new PluginManagement(base);
    this.market = new PluginMarket({ base, management: this.management, installed: () => this.installed });
    this.broker = new Broker({ base, platform, event, context: () => this.context });
    this.lifecycle = new Lifecycle(this); this.closing = false;
  }
  async load(input) {
    if (!input.manifest?.id) throw apiError("INVALID_ARGUMENT", "加载需要已经核对的插件清单");
    this.lifecycle.cancel(input.manifest.id);
    return this.lifecycle.serial(input.manifest.id, () => this.loadEntry(input));
  }
  async loadEntry(input) {
    if (this.closing) throw apiError("PLUGIN_UNLOADED", "宿主正在退出");
    const snapshot = await readDirectory(input.path);
    const manifest = snapshot.manifest;
    if (!manifest.main) throw apiError("INVALID_ARGUMENT", "此插件为静态插件");
    if (input.manifest && !isDeepStrictEqual(input.manifest, JSON.parse(JSON.stringify(manifest)))) {
      throw apiError("PLUGIN_CHANGED", "插件清单已变化，请重新预览");
    }
    await this.unloadEntry(manifest.id);
    const entry = { ...input, path: snapshot.root, manifest, files: snapshot.files, digest: snapshot.digest, status: "loading", abort: new AbortController(),
      scope: this.management.preference(manifest.id).scope, settings: await getSettings(this.broker.base, manifest) };
    entry.scopeActive = inScope(entry.scope, this.context.workspace);
    entry.contributions = staticContributions(entry, snapshot.files);
    this.entries.set(manifest.id, entry); this.errors.delete(manifest.id);
    entry.child = new PluginChild({ path: entry.path,
      onHost: (api, args, context) => this.broker.call(entry, { api, args }, context),
      onExit: (code) => this.crashed(entry, code),
      onLog: (message) => this.event("log", { pluginId: manifest.id, message }),
    });
    try {
      const result = await entry.child.invoke("init", { path: entry.path, manifest });
      if (entry.scopeActive) await this.broker.extensions.start(entry);
      await this.broker.mcp.load(entry);
      if (entry.stopping || this.entries.get(manifest.id) !== entry) throw apiError("PLUGIN_EXITED", "插件在启动时退出");
      entry.status = "ready";
      this.lifecycle.watch(entry);
      this.event("catalogChanged", { pluginId: manifest.id });
      return { id: manifest.id, pid: result.pid };
    } catch (error) {
      await this.unloadEntry(manifest.id);
      this.errors.set(manifest.id, error.message);
      this.event("error", { pluginId: manifest.id, message: error.message });
      throw error;
    }
  }
  crashed(entry, code) {
    if (entry.stopping || this.entries.get(entry.manifest.id) !== entry) return;
    entry.stopping = true;
    entry.abort.abort(apiError("PLUGIN_UNLOADED", "插件已停止"));
    this.broker.forget(entry.manifest.id);
    void this.broker.mcp.close(entry.manifest.id);
    void this.broker.browser.forget(entry.manifest.id);
    void entry.panel?.close();
    void this.broker.platform({ api: "ui.closePanel", pluginId: entry.manifest.id, args: [] }).catch(() => {});
    this.entries.delete(entry.manifest.id);
    this.errors.set(entry.manifest.id, `插件进程意外退出（${code}）`);
    this.event("error", { pluginId: entry.manifest.id, message: this.errors.get(entry.manifest.id) });
    this.lifecycle.crashed(entry);
  }
  async unload(id) {
    this.lifecycle.cancel(id);
    return this.lifecycle.serial(id, () => this.unloadEntry(id));
  }
  async unloadEntry(id) {
    this.errors.delete(id);
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.stopping = true;
    entry.abort.abort(apiError("PLUGIN_UNLOADED", "插件已停止"));
    clearInterval(entry.watcher);
    await this.broker.extensions.stop(entry);
    await entry.child?.stop();
    await this.broker.mcp.close(id);
    await this.broker.browser.forget(id);
    await entry.panel?.close();
    if (entry.panel && !this.closing) await this.broker.platform({ api: "ui.closePanel", pluginId: id, args: [] }).catch(() => {});
    this.broker.forget(id); this.entries.delete(id);
    this.event("catalogChanged", { pluginId: id });
  }
  get(id) {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== "ready") throw apiError("NOT_FOUND", "插件未运行");
    return entry;
  }
  async invoke(method, input) {
    const entry = this.get(input.pluginId);
    if (!inScope(entry.scope, (input.context ?? this.context).workspace)) throw apiError("PERMISSION_DENIED", "插件不在当前项目生效");
    const key = `${input.pluginId}:${method === "command" ? input.commandId : input.name}`;
    const collection = method === "command" ? this.broker.commands : this.broker.tools;
    if (!collection.has(key)) throw apiError("NOT_FOUND", "贡献已撤销");
    const context = invocationContext(input.context ?? this.context, entry);
    if (method === "tool") context.toolName = input.name;
    if (collection.get(key).peerKey) {
      const result = await this.broker.mcp.invoke(collection.get(key), input.args ?? {}, context);
      activeContext(context); return result;
    }
    const result = await this.invokeChild(entry, { method, input }, context);
    activeContext(context); return result;
  }
  invokeChild(entry, { method, input }, context) {
    const publicContext = { sessionId: context.agentSession?.id ?? context.sessionId, turnId: context.turnId, modelKey: context.modelKey, thinkingLevel: context.thinkingLevel };
    return entry.child.invoke(method, { id: input.commandId, name: input.name, args: input.args ?? {}, context: publicContext },
      { context, timeout: method === "tool" ? 110_000 : 15_000 });
  }
  catalog(context = this.context, { themeContents = true } = {}) {
    const entries = [...this.entries.values()].filter((entry) => entry.status === "ready" && inScope(entry.scope, context.workspace));
    const ids = new Set(entries.map((entry) => entry.manifest.id));
    return { commands: [...this.broker.commands.values()].filter((item) => ids.has(item.pluginId)), tools: [...this.broker.tools.values()].filter((item) => ids.has(item.pluginId)),
      plugins: [...this.entries.values()].map((entry) => ({ id: entry.manifest.id, status: entry.status, pid: entry.child.process.pid })),
      errors: Object.fromEntries(this.errors), skills: entries.flatMap((entry) => entry.contributions.skills.map(({ content, ...skill }) => skill)),
      themes: entries.flatMap((entry) => entry.contributions.themes.map(({ css, ...theme }) => themeContents ? { ...theme, css } : theme)),
      views: entries.flatMap((entry) => entry.contributions.views),
      services: [...this.broker.extensions.services.values()],
      shortcuts: entries.flatMap((entry) => (entry.manifest.contributes?.settings ?? []).filter((setting) => setting.type === "shortcut" && setting.command)
        .map((setting) => ({ pluginId: entry.manifest.id, commandId: setting.command, binding: entry.settings?.[setting.key] ?? setting.default ?? "" }))) };
  }
  skill(input, context = this.context) {
    const entry = this.get(input.pluginId);
    if (!inScope(entry.scope, context.workspace)) throw apiError("PERMISSION_DENIED", "Skill 不在当前项目生效");
    const result = entry.contributions.skills.find((item) => item.path === input.path);
    if (!result) throw apiError("NOT_FOUND", "Skill 不存在或已撤销");
    return result.content;
  }
  theme(input) {
    const entry = this.get(input.pluginId);
    if (!inScope(entry.scope, this.context.workspace)) throw apiError("PERMISSION_DENIED", "主题不在当前项目生效");
    const theme = entry.contributions.themes.find((item) => item.id === input.id);
    if (!theme) throw apiError("NOT_FOUND", "主题不存在或已撤销");
    if (theme.cssDigest !== input.cssDigest) throw apiError("PLUGIN_CHANGED", "主题内容已变化，请刷新目录");
    return theme.css;
  }
  async activateScope(entry) {
    const active = inScope(entry.scope, this.context.workspace);
    entry.scopeActive = active;
    if (active) await this.broker.extensions.start(entry);
    else { await this.broker.extensions.stop(entry); await this.broker.platform({ api: "ui.closePanel", pluginId: entry.manifest.id, args: [] }); }
  }
  async setContext(input) {
    const previous = this.context; this.context = input;
    await this.broker.browser.changed();
    for (const entry of this.entries.values()) {
      entry.child.setPanelContext(input);
      await this.activateScope(entry);
      for (const name of ["workspace:changed", "appearance:changed"]) {
        const args = [name === "workspace:changed" ? { path: input.workspace ?? null } : input.appearance ?? { theme: input.theme, base: input.theme, locale: input.locale, pluginTheme: null }];
        entry.child.send({ type: "event", name, args }); entry.panel?.emit(name, args);
      }
    }
    this.event("catalogChanged", {});
    return previous;
  }
  async close() {
    this.closing = true;
    await this.lifecycle.close();
    for (const id of [...this.entries.keys()]) await this.unload(id);
    await this.broker.browser.close();
  }
}
