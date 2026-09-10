export type LocalizedText = string | { en?: string; "zh-CN"?: string };
export interface PiSetting {
  key: string; title?: string; description?: string; type: "string" | "number" | "boolean" | "select" | "json" | "shortcut";
  default?: unknown; enum?: { label: string; value: string | number | boolean }[]; command?: string;
}
export interface PiManifest {
  schemaVersion: 1; id: string; name: string; version: string; main: string;
  engines?: { piDesktop?: string }; permissions?: string[];
  ui?: { panel?: string; title?: LocalizedText; width?: number; height?: number };
  fs?: Record<string, { root?: string; scope?: string[] }>; net?: { domains?: string[] };
  contributes?: {
    settings?: PiSetting[]; agentTools?: unknown[]; views?: unknown[]; themes?: unknown[];
    services?: unknown[]; mcpServers?: unknown[]; bus?: { publish?: string[]; subscribe?: string[] };
  };
}
interface Contribution { pluginId: string; pluginName: string }
export interface RuntimeCommand extends Contribution { id: string; title: string; keywords?: string[] }
export interface RuntimeTool extends Contribution { name: string; description: string; risk?: string; schema?: Record<string, unknown> }
export interface RuntimeSkill extends Contribution { id: string; name: string; description?: string; path: string }
export interface RuntimeView extends Contribution { id: string; title: LocalizedText; icon?: string; order?: number }
export interface RuntimeTheme extends Contribution { id: string; label: string; base?: "light" | "dark"; css: string }
export interface RuntimeService extends Contribution { id: string; label?: string; status: string; restarts?: number; message?: string }
export interface RuntimeCatalog {
  available: boolean; error?: string; errors: Record<string, string>;
  commands: RuntimeCommand[]; tools: RuntimeTool[]; skills: RuntimeSkill[];
  views: RuntimeView[]; themes: RuntimeTheme[]; services: RuntimeService[];
  plugins: { id: string; status: string; pid: number }[];
  shortcuts?: { pluginId: string; commandId: string; binding: string }[];
}
export const emptyRuntimeCatalog: RuntimeCatalog = {
  available: false, errors: {}, commands: [], tools: [], skills: [], views: [], themes: [], services: [], plugins: [],
};
export type PluginTemplate = "panel-basic" | "agent-tool-basic" | "skill-pack" | "full-demo";
export interface ScaffoldInput { directory: string; template: PluginTemplate; id: string; name: string }
export interface PluginCheck { ok: boolean; manifest: PiManifest; digest: string; fileCount: number; totalBytes: number; warnings: string[] }
export interface PluginPackage { packagePath: string; fileName: string; byteLength: number; sha256: string }
