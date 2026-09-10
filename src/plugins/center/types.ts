// Adapted from PI-Desktop 4fb58d3, LGPL-3.0. See third_party/pi-desktop/NOTICE.md.
import type { ActivationScope } from "./activation";
export type { ActivationScope } from "./activation";
export type PluginMarketSource = "personal" | "belfry" | "official" | "mirror" | "custom";
export type PluginUpdateInfo = {
  version: string;
  changelog?: string;
  shasum: string;
  url: string;
  permissionDiff?: string[];
};
export type MarketTrust = "verified" | "community" | "unknown";
export type MarketProvenance = {
  sourceRepository: string;
  sourceRef?: string;
  sourceCommit?: string;
  sourcePath?: string;
  builder?: string;
  builtAt?: string;
};
export type MarketReview = {
  decision?: string;
  risk?: string;
  policyVersion?: string;
  reviewedAt?: string;
};
export type PluginYankNotice = {
  version: string;
  reason?: string;
};
export type PluginMarketplaceMeta = {
  providerId: string;
  shasum?: string;
  publisherId?: string;
  trust?: MarketTrust;
  provenance?: MarketProvenance;
};
export type PluginUiMeta = {
  panel?: string;
  width?: number;
  height?: number;
  title?: string | PluginLocalizedString;
};
export type PluginViewMeta = {
  pluginId: string;
  viewId: string;
  ref: string;
  title: string;
  pluginName: string;
  icon?: string;
  order: number;
};
export type PluginFsRule = {
  root?: "workspace" | "userSelected";
  scope?: string[];
  own?: boolean;
};
export type PluginFsPolicy = {
  read?: PluginFsRule;
  write?: PluginFsRule;
  delete?: PluginFsRule;
};
export type PluginLocalizedString = {
  en: string;
  "zh-CN": string;
};
export type PluginCapability =
  | "panel"
  | "views"
  | "commands"
  | "tools"
  | "skills"
  | "themes"
  | "mcp"
  | "services"
  | "bus";
export type PluginSettingType =
  | "string"
  | "number"
  | "boolean"
  | "select"
  | "json"
  | "shortcut";
export type PluginSettingOption = {
  label: string;
  value: string | number | boolean;
};
export type PluginSettingDefinition = {
  key: string;
  title: string;
  description?: string;
  type: PluginSettingType;
  default?: unknown;
  enum?: PluginSettingOption[];
  command?: string;
  scope?: "plugin";
  value?: unknown;
};
export type PluginServiceState = "starting" | "running" | "stopped" | "failed";
export type PluginServiceStatus = {
  pluginId: string;
  serviceId: string;
  label: string;
  state: PluginServiceState;
  restarts: number;
  message?: string;
  updatedAt: number;
};
export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  scope?: ActivationScope;
  source: "installed" | "dev" | "marketplace";
  status: "ready" | "error" | "disabled" | "load_error";
  errorMessage?: string;
  permissions: string[];
  path?: string;
  capabilities?: PluginCapability[];
  description?: string;
  author?: string;
  installedAt?: string;
  updatedAt?: string;
  marketplace?: PluginMarketplaceMeta;
  autoUpdate?: boolean;
  updateAvailable?: PluginUpdateInfo;
  yanked?: PluginYankNotice;
  ui?: PluginUiMeta;
  fs?: PluginFsPolicy;
  settings?: PluginSettingDefinition[];
};
export type MarketPluginSummary = {
  id: string;
  name: string;
  description: string;
  author: string;
  iconUrl?: string;
  latestVersion: string;
  downloads?: number;
  updatedAt: string;
  categories?: string[];
  permissionSummary: string[];
  verified?: boolean;
  trust?: MarketTrust;
  publisherId?: string;
  installed?: boolean;
  installedVersion?: string;
  updateAvailable?: boolean;
  installable?: boolean;
  yanked?: boolean;
};
export type MarketPluginDetail = MarketPluginSummary & {
  readmeMarkdown?: string;
  versions: Array<{
    version: string;
    publishedAt: string;
    changelog?: string;
    minPiDesktop?: string;
    shasum: string;
    url: string;
    sizeBytes: number;
    permissions: string[];
    yanked?: boolean;
    yankedReason?: string;
    provenance?: MarketProvenance;
    review?: MarketReview;
    signature?: string;
    signatureAlg?: string;
    keyId?: string;
  }>;
  screenshots?: string[];
  homepage?: string;
  repository?: string;
  permissions: string[];
  safetyNotes?: string;
};
export type PluginInstallResult = {
  plugin: PluginSummary;
  upgraded: boolean;
  permissionDiff: string[];
};
export interface ProjectRecord { path: string; name: string }
export interface MarketSettings { pluginMarketSource: PluginMarketSource; pluginMarketCustomUrl: string }
