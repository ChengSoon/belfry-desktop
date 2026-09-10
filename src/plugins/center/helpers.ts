// Adapted from PI-Desktop 4fb58d3, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import type { PluginCapability, PluginSummary } from "./types";
export type TabId = "installed" | "market";
export type GroupId = "attention" | "updates" | "active" | "disabled";
export const GROUP_ORDER: GroupId[] = ["attention", "updates", "active", "disabled"];
export const GROUP_LABEL_KEYS = { attention: "plugins.groupAttention", updates: "plugins.groupUpdates", active: "plugins.groupActive", disabled: "plugins.groupDisabled" };
export const TEMPLATE_IDS = ["panel-basic", "agent-tool-basic", "skill-pack", "full-demo"] as const;
export type TemplateId = typeof TEMPLATE_IDS[number];
export type RiskTier = "high" | "medium" | "low";
const PERMISSION_RISK: Record<string, RiskTier> = {
  "net.fetch": "high", "fs.write": "high", "fs.delete": "high", "fs.write.workspace": "high", "fs.delete.workspace": "high",
  "agent.prompt.inject": "high", "agent.tool.register": "high", "agent.complete": "high", "session.read": "high",
  "browser.cdp": "high", "browser.evaluate": "high", "browser.interact": "high", "browser.control": "medium", "browser.read": "medium",
  "fs.read": "medium", "fs.read.workspace": "medium", "models.list": "medium", "clipboard.read": "medium", "clipboard.write": "medium",
  "shell.openExternal": "medium", "mcp.server.local": "high", "mcp.server.remote": "high", "background.service": "high",
  "bus.publish": "medium", "bus.subscribe": "medium", "ui.panel": "low", "ui.view": "low", "ui.theme": "low", notify: "low",
};
export const CAPABILITY_ORDER: PluginCapability[] = ["panel", "views", "commands", "tools", "skills", "themes", "mcp", "services", "bus"];
export const RISK_TIERS: RiskTier[] = ["high", "medium", "low"];
export const RISK_LABEL_KEYS = { high: "plugins.riskHigh", medium: "plugins.riskMedium", low: "plugins.riskLow" };
export const FS_MODES = ["read", "write", "delete"] as const;
export function permissionRisk(key: string): RiskTier { return PERMISSION_RISK[key] ?? "high"; }
export function orderPermissions(values?: readonly string[]) {
  return [...new Set(values ?? [])].sort((a, b) => RISK_TIERS.indexOf(permissionRisk(a)) - RISK_TIERS.indexOf(permissionRisk(b)) || a.localeCompare(b));
}
export function groupOf(plugin: PluginSummary): GroupId {
  if (["error", "load_error"].includes(plugin.status)) return "attention";
  if (plugin.updateAvailable) return "updates";
  return plugin.enabled ? "active" : "disabled";
}
export function installedGroups(plugins: PluginSummary[], query: string) {
  const needle = query.trim().toLocaleLowerCase();
  const filtered = plugins.filter((p) => [p.name, p.id, p.description, p.author].some((s) => s?.toLocaleLowerCase().includes(needle)));
  return GROUP_ORDER.map((id) => ({ id, rows: filtered.filter((p) => groupOf(p) === id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.rows.length);
}
export function monogram(name: string) { return [...name.trim()][0]?.toLocaleUpperCase() ?? "?"; }
export function showsVerifiedBadge(entry?: { trust?: string; verified?: boolean } | null) { return entry?.trust ? entry.trust === "verified" : !!entry?.verified; }
export function versionInstallable(version?: { url?: string; shasum?: string; yanked?: boolean } | null) { return !!version?.url?.trim() && !!version.shasum?.trim() && !version.yanked; }
export function formatDate(value?: string) { const date = new Date(value ?? ""); return Number.isNaN(+date) ? "—" : date.toLocaleDateString("zh-CN", { year: "numeric", month: "short", day: "numeric" }); }
export function formatBytes(size?: number) { return !size ? "—" : size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(2)} MB`; }
export function shortSha(value?: string) { return !value ? "—" : value.length > 12 ? `${value.slice(0, 12)}…` : value; }
