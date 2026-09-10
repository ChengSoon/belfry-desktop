import type { DirectoryRegistry } from "./hostContracts";
export function staticCatalog(registry: DirectoryRegistry | null) {
  const entries = registry?.plugins.filter(({ enabled, error, manifest }) => enabled && !error && !manifest.runtime
    && !manifest.permissions.includes("harnesses") && !manifest.contributes.harnesses?.length) ?? [];
  return {
    commands: entries.flatMap(({ manifest }) => manifest.contributes.commands.map((item) => ({ ...item, key: `${manifest.id}:${item.id}`, pluginId: manifest.id, pluginName: manifest.name }))),
    skills: entries.flatMap(({ manifest }) => manifest.contributes.skills.map((item) => ({ ...item, key: `${manifest.id}:${item.id}`, pluginId: manifest.id, pluginName: manifest.name }))),
    settings: entries.flatMap(({ manifest }) => manifest.contributes.settings.map((item) => ({ ...item, key: `${manifest.id}:${item.id}`, pluginId: manifest.id, pluginName: manifest.name }))),
  };
}
