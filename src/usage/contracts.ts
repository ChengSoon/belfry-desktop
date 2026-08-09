import type { AgentKind } from "../workspace/contracts";

/** 四类 token 的统一口径，两家 Agent 归一后可直接对比。input 不含缓存命中部分。 */
export interface TokenTotals {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export interface ModelUsage {
  agent: AgentKind;
  model: string;
  tokens: TokenTotals;
  requests: number;
  /** epoch 秒 */
  lastUsedAt: number | null;
}

export interface QuotaWindow {
  usedPercent: number;
  windowMinutes: number | null;
  /** epoch 秒 */
  resetsAt: number | null;
}

/** 套餐额度。目前只有 Codex 的会话日志提供，Claude 日志不含额度字段。 */
export interface AgentQuota {
  agent: AgentKind;
  planType: string | null;
  primary: QuotaWindow | null;
  secondary: QuotaWindow | null;
  observedAt: number | null;
}

export interface ProjectUsage {
  rootPath: string;
  name: string;
  tokens: TokenTotals;
}

export interface UsageReport {
  models: ModelUsage[];
  totals: TokenTotals;
  quotas: AgentQuota[];
  projects: ProjectUsage[];
  scannedFiles: number;
  skippedFiles: number;
  windowDays: number | null;
  generatedAt: number;
}

/** null 表示不限时间 */
export type UsageWindow = number | null;

export interface UsageQuery {
  windowDays: UsageWindow;
  projectRoot: string | null;
}

export const USAGE_WINDOWS: { label: string; days: UsageWindow }[] = [
  { label: "近 7 天", days: 7 },
  { label: "近 30 天", days: 30 },
  { label: "全部", days: null },
];
