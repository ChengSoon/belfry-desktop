import type { PluginEntry, PluginManifest, PluginRegistry } from "./contracts";
import { comparePluginVersions } from "./version";
export type MutationResult = { outcome: "applied" | "no-change"; registry: PluginRegistry };
export function setEnabled(registry: PluginRegistry, pluginId: string, { enabled, now }: { enabled: boolean; now: number }): MutationResult {
  const index = registry.plugins.findIndex((entry) => entry.currentManifest.id === pluginId);
  if (index < 0) throw new Error("插件不存在");
  if (registry.plugins[index].enabled === enabled) return { outcome: "no-change", registry };
  return applied(registry, registry.plugins.map((entry, item) => item === index ? { ...entry, enabled, updatedAt: now } : entry));
}

export function replace(registry: PluginRegistry, manifest: PluginManifest, { sourceFileName, now }: { sourceFileName: string | null; now: number }): MutationResult {
  const index = registry.plugins.findIndex((entry) => entry.currentManifest.id === manifest.id);
  if (index < 0) throw new Error("插件不存在");
  if (comparePluginVersions(registry.plugins[index].currentManifest.version, manifest.version) === 0) throw new Error("同版本插件已安装");
  const next: PluginEntry = { ...registry.plugins[index], currentManifest: manifest,
    previousManifest: registry.plugins[index].currentManifest, enabled: false, sourceFileName, updatedAt: now };
  return applied(registry, registry.plugins.map((entry, item) => item === index ? next : entry));
}

export function rollback(registry: PluginRegistry, pluginId: string, now: number): MutationResult {
  const index = registry.plugins.findIndex((entry) => entry.currentManifest.id === pluginId);
  const current = index < 0 ? null : registry.plugins[index];
  if (!current?.previousManifest) throw new Error("没有可回退版本");
  const next: PluginEntry = { ...current, currentManifest: current.previousManifest,
    previousManifest: null, enabled: false, sourceFileName: null, updatedAt: now };
  return applied(registry, registry.plugins.map((entry, item) => item === index ? next : entry));
}

const MAX_REVISION = 18446744073709551615n;
function applied(registry: PluginRegistry, plugins: PluginEntry[]): MutationResult {
  const revision = BigInt(registry.revision);
  if (revision === MAX_REVISION) throw new Error("revision已耗尽");
  return { outcome: "applied", registry: { ...registry, revision: (revision + 1n).toString(), plugins } };
}
