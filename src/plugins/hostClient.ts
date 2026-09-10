import { invoke } from "@tauri-apps/api/core";
import type { DirectoryRegistry, InstallPreview, PluginOperation } from "./hostContracts";
import type { PluginCheck, PluginPackage, RuntimeCatalog, ScaffoldInput } from "./runtimeContracts";
interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
const bridge: Bridge = { invoke };
export class PluginHostClient {
  constructor(private readonly transport: Bridge = bridge) {}
  async list() { return decodeRegistry(await this.transport.invoke("plugins_list")); }
  async inspect(path: string, development: boolean) {
    const result = await this.transport.invoke("plugins_inspect", { path, development });
    if (!record(result) || typeof result.previewId !== "string" || !record(result.manifest) || typeof result.sourcePath !== "string") throw new Error("插件预览响应无效");
    return result as unknown as InstallPreview;
  }
  async cancel(previewId: string) { await this.transport.invoke("plugins_cancel_preview", { previewId }); }
  async install(previewId: string, expectedRevision: string) {
    return decodeRegistry(await this.transport.invoke("plugins_install", { previewId, expectedRevision }));
  }
  async mutate(pluginId: string, action: PluginOperation, expectedRevision: string) {
    return decodeRegistry(await this.transport.invoke("plugins_mutate", { pluginId, action, expectedRevision }));
  }
  async skill(pluginId: string, skillId: string) {
    const value = await this.transport.invoke("plugins_skill", { pluginId, skillId });
    if (typeof value !== "string") throw new Error("Skill 响应无效"); return value;
  }
  async runtime() {
    const value = await this.requestRuntime<RuntimeCatalog>("catalog");
    if (!record(value) || typeof value.available !== "boolean" || !record(value.errors)) throw new Error("插件运行状态响应无效");
    for (const key of ["commands", "tools", "skills", "views", "themes", "services", "plugins"] as const) {
      if (!Array.isArray(value[key])) throw new Error("插件运行贡献响应无效");
    }
    return value;
  }
  requestRuntime<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    return this.transport.invoke("plugins_runtime", { method, params }) as Promise<T>;
  }
  runCommand(pluginId: string, commandId: string) { return this.requestRuntime("command", { pluginId, commandId }); }
  openPanel(pluginId: string, viewId?: string) { return this.requestRuntime("panel", { pluginId, ...(viewId ? { viewId } : {}) }); }
  getSettings(pluginId: string) { return this.requestRuntime<Record<string, unknown>>("settings.get", { pluginId }); }
  setSettings(pluginId: string, values: Record<string, unknown>) { return this.requestRuntime<Record<string, unknown>>("settings.set", { pluginId, values }); }
  scaffold(input: ScaffoldInput) { return this.requestRuntime<{ directory: string }>("author.scaffold", { ...input }); }
  check(directory: string) { return this.requestRuntime<PluginCheck>("author.check", { directory }); }
  pack(directory: string, out?: string) { return this.requestRuntime<PluginPackage>("author.pack", { directory, ...(out ? { out } : {}) }); }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function decodeRegistry(value: unknown): DirectoryRegistry {
  if (!record(value) || value.format !== "belfry-directory-plugins-v1" || value.storeSchemaVersion !== 1 || typeof value.revision !== "string" || !/^(0|[1-9]\d*)$/.test(value.revision) || !Array.isArray(value.plugins)) throw new Error("不支持旧插件目录，请保留原文件并检查格式");
  value.plugins.forEach(validateEntry);
  return value as unknown as DirectoryRegistry;
}
function validateEntry(entry: unknown) {
    if (!record(entry) || !record(entry.manifest) || typeof entry.enabled !== "boolean" || typeof entry.sourcePath !== "string" || !record(entry.manifest.contributes)) throw new Error("插件目录响应无效");
    for (const kind of ["commands", "skills", "settings"]) {
      if (!Array.isArray(entry.manifest.contributes[kind])) throw new Error("插件贡献响应无效");
    }
    const legacy = entry.manifest.contributes.harnesses;
    if (legacy !== undefined && !Array.isArray(legacy)) throw new Error("旧插件贡献响应无效");
}
export function pluginError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  if (record(reason) && typeof reason.message === "string") return reason.message;
  return "插件操作失败，请重新读取后重试";
}
