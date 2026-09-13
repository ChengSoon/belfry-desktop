import type { UsageQuery } from "../contracts";
import type { AnalyticsReport } from "./contracts";

export interface InsightState { report: AnalyticsReport | null; loading: boolean; error: string | null }

export function createInsightRequests(fetch: (query: UsageQuery) => Promise<AnalyticsReport>, receive: (state: InsightState) => void) {
  let version = 0;
  const load = async (query: UsageQuery) => {
    const current = ++version;
    receive({ report: null, loading: true, error: null });
    try {
      const report = await fetch(query);
      if (version === current) receive({ report, loading: false, error: null });
    } catch (error) {
      if (version === current) receive({ report: null, loading: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  return { load, cancel: () => { version += 1; } };
}
