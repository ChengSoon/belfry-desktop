export type PluginTemplateKind = "prompt" | "recipe";
export interface PluginStep { id: string; text: string }
export interface PluginTemplate { id: string; kind: PluginTemplateKind; name: string; description?: string | null; steps: PluginStep[] }
export interface PluginAction { id: string; title: string; templateId: string; keywords?: string[] }
export interface PluginManifest {
  schemaVersion: 1; id: string; name: string; version: string; description?: string;
  author: string; compatibility: { pluginApi: 1; minAppVersion: string; maxAppVersionExclusive?: string };
  contributes: { templates: PluginTemplate[]; actions?: PluginAction[] };
}
export interface PluginEntry { currentManifest: PluginManifest; enabled: boolean; installedAt: number; updatedAt: number; sourceFileName: string | null; previousManifest?: PluginManifest | null }
export interface PluginRegistry { storeSchemaVersion: 1; revision: string; plugins: PluginEntry[] }
export const PLUGIN_LIMITS = { fileBytes: 1_048_576, plugins: 50, templates: 40, actions: 40, steps: 20, textBytes: 16_384 } as const;
