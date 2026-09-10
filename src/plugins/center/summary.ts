import type { DirectoryEntry } from "../hostContracts";
import type { RuntimeCatalog } from "../runtimeContracts";
import type { PiManifest } from "../runtimeContracts";
import type { PluginPreference } from "./api";
import type { MarketPluginSummary, PluginCapability, PluginSummary } from "./types";

export function pluginSummary(entry: DirectoryEntry, runtime: RuntimeCatalog, preference?: PluginPreference): PluginSummary {
  const { manifest, enabled } = entry;
  const pi = manifest.runtime;
  const error = entry.error ?? runtime.errors[manifest.id];
  return { id: manifest.id, name: manifest.name, version: manifest.version, enabled,
    ...stateFields(entry, error, preference),
    path: entry.sourcePath, errorMessage: error ?? undefined,
    permissions: pi?.permissions ?? manifest.permissions, capabilities: capabilities(entry),
    description: manifest.description ?? undefined, author: manifest.author,
    scope: preference?.scope, autoUpdate: preference?.autoUpdate ?? false,
    ui: panelUi(pi), fs: pi?.fs as PluginSummary["fs"],
    settings: pi?.contributes?.settings?.map((item) => ({ ...item, title: item.title ?? item.key })),
  };
}
function stateFields(entry: DirectoryEntry, error: string | null | undefined, preference?: PluginPreference): Pick<PluginSummary, "source" | "status"> {
  return { source: entry.source === "development" ? "dev" : preference?.marketplace ? "marketplace" : "installed",
    status: error ? "load_error" : entry.enabled ? "ready" : "disabled" };
}
function panelUi(pi?: PiManifest) {
  if (!pi?.ui) return undefined;
  return { ...pi.ui, title: typeof pi.ui.title === "object" ? pi.ui.title["zh-CN"] ?? pi.ui.title.en : pi.ui.title };
}
function capabilities({ manifest }: DirectoryEntry) {
  const pi = manifest.runtime, contributes = pi?.contributes as Record<string, unknown[]> | undefined;
  const capabilities: PluginCapability[] = [];
  if (pi?.ui?.panel) capabilities.push("panel");
  const mappings = { commands: "commands", agentTools: "tools", skills: "skills", views: "views", themes: "themes", mcpServers: "mcp", services: "services" } as const;
  for (const [field, capability] of Object.entries(mappings)) {
    if (contributes?.[field]?.length || (manifest.contributes as unknown as Record<string, unknown[]>)[field]?.length) capabilities.push(capability);
  }
  if (pi?.contributes?.bus) capabilities.push("bus");
  return capabilities;
}

export function withUpdates(plugin: PluginSummary, market: MarketPluginSummary[]): PluginSummary {
  const available = market.find((item) => item.id === plugin.id && item.updateAvailable);
  if (!available) return plugin;
  const permissions = available.permissionSummary.filter((value) => !plugin.permissions.includes(value));
  return { ...plugin, updateAvailable: { version: available.latestVersion, permissionDiff: permissions, shasum: "", url: "" } };
}
