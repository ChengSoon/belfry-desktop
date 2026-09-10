import type { PiManifest } from "./runtimeContracts";
// 插件宿主私有 IPC；旧 Prompt/Recipe 原型不参与解码或持久化。
export interface StaticContributions {
  commands: { id: string; title: string; text: string }[];
  skills: { id: string; title: string; path: string }[];
  settings: { id: string; title: string; description: string; default: string }[];
  /** 仅兼容旧 registry；不再对外提供 Harness 贡献。 */
  harnesses?: unknown[];
}
export interface DirectoryManifest {
  schemaVersion: 1; id: string; name: string; version: string; author: string;
  description: string | null; icon: string | null;
  compatibility: { pluginApi: 1; minAppVersion: string; maxAppVersionExclusive: string | null };
  permissions: string[]; activationEvents: string[]; contributes: StaticContributions;
  runtime?: PiManifest;
}
export interface DirectoryEntry {
  manifest: DirectoryManifest; enabled: boolean; source: "installed" | "development";
  sourcePath: string; installedAt: number; updatedAt: number; error: string | null;
}
export interface DirectoryRegistry {
  format: "belfry-directory-plugins-v1"; storeSchemaVersion: 1; revision: string; plugins: DirectoryEntry[];
}
export interface InstallPreview {
  previewId: string; manifest: DirectoryManifest; sourcePath: string; development: boolean;
  digest: string; fileCount: number; totalBytes: number;
}
export type PluginOperation = "enable" | "disable" | "reload" | "uninstall";
