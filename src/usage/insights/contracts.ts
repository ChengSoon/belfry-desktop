import type { AgentKind } from "../../workspace/contracts";
import type { AgentQuota, TokenTotals, UsageWindow } from "../contracts";

export interface UsageBucket {
  agent: AgentKind;
  model: string;
  /** UTC 当天零点，epoch 秒；null 代表无有效日期。 */
  day: number | null;
  projectRoot: string | null;
  projectName: string | null;
  tokens: TokenTotals;
  requests: number;
}

export interface AnalyticsReport {
  rows: UsageBucket[];
  quotas: AgentQuota[];
  scannedFiles: number;
  skippedFiles: number;
  undatedRecords: number;
  windowDays: UsageWindow;
  projectRoot: string | null;
  startAt: number | null;
  endAt: number;
  generatedAt: number;
}

export interface InsightFilter {
  /** undefined 表示全部，null 表示日期未知或项目未知。 */
  day?: number | null;
  projectRoot?: string | null;
}
