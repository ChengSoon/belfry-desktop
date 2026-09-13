import type { AgentSessionRef } from "../../agent/contracts";

export interface SessionStatisticsQuery { session: AgentSessionRef; transcriptPath: string | null }
export interface SessionTokens { input: number | null; cachedInput: number | null; cacheWrite: number | null; output: number | null }
export interface SessionStatistics {
  session: AgentSessionRef;
  tokens: SessionTokens;
  models: string[];
  currentModel: string | null;
  tools: { name: string; calls: number }[];
  toolCount: number | null;
  updatedAt: number | null;
  observedAt: number;
  sourceFiles: number;
  scannedBytes: number;
  pending: boolean;
  skippedLines: number;
  note: string | null;
}

export interface StatisticsView { report: SessionStatistics | null; loading: boolean; error: string | null }
export const EMPTY_STATISTICS: StatisticsView = { report: null, loading: false, error: null };
