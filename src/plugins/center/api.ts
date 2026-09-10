import { pluginHost } from "../useDirectoryRegistry";
import type { ActivationScope, MarketPluginDetail, MarketPluginSummary, MarketSettings } from "./types";
import type { InstallPreview } from "../hostContracts";

export interface PluginPreference {
  scope?: ActivationScope; autoUpdate?: boolean; marketplace?: { providerId: string; shasum?: string };
}
export interface ManagementSnapshot { settings: MarketSettings; plugins: Record<string, PluginPreference> }
export interface MarketSnapshot { plugins: MarketPluginSummary[]; sourceUrl: string; offline?: boolean; cached?: boolean }
export interface MarketMeta { sourceUrl: string; pluginCount: number }
export interface MarketInstall { id: string; version?: string; previewId: string; enable: boolean; autoUpdate: boolean; grantedPermissions: string[] }
export interface PersonalMarketInfo { directory: string; name: string; pluginCount: number; versionCount: number }
export const centerApi = {
  management: () => pluginHost.requestRuntime<ManagementSnapshot>("management.get"),
  setPreference: (id: string, patch: PluginPreference) => pluginHost.requestRuntime("management.plugin", { id, patch }),
  setSource: (settings: MarketSettings) => pluginHost.requestRuntime("management.source", { settings }),
  marketSearch: (query = "") => pluginHost.requestRuntime<MarketSnapshot>("market.search", { query }),
  marketRefresh: () => pluginHost.requestRuntime<MarketMeta>("market.refresh"),
  marketDetail: (id: string) => pluginHost.requestRuntime<MarketPluginDetail>("market.detail", { id }),
  marketInspect: (id: string, version?: string) => pluginHost.requestRuntime<{ preview: InstallPreview }>("market.inspect", { id, version }),
  marketInstall: (input: MarketInstall) => pluginHost.requestRuntime("market.install", { ...input }),
  checkUpdates: (refreshRemote = true) => pluginHost.requestRuntime<{ updates: unknown[] }>("market.updates", { refreshRemote }),
  applyUpdates: () => pluginHost.requestRuntime<{ results: unknown[]; skipped: string[] }>("market.applyUpdates"),
  create: (template: string, metadata: { id?: string; name?: string; author?: string } = {}) => pluginHost.requestRuntime<{ canceled?: boolean; directory?: string; name?: string }>("author.create", { template, ...metadata }),
  personalMarket: () => pluginHost.requestRuntime<PersonalMarketInfo>("market.personal.info"),
  nameMarket: (name: string) => pluginHost.requestRuntime<PersonalMarketInfo>("market.personal.configure", { name }),
  publish: (input: { directory: string; changelog: string; expectedDigest: string }) => pluginHost.requestRuntime<{ id: string; version: string }>("market.personal.publish", input),
  exportMarket: (directory: string) => pluginHost.requestRuntime<{ directory: string; pluginCount: number }>("market.personal.export", { directory }),
  openExternal: (url: string) => pluginHost.requestRuntime("desktop.openExternal", { url }),
  reveal: (directory: string) => pluginHost.requestRuntime("desktop.reveal", { directory }),
};
