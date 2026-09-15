import type { UsageQuery } from "../contracts";
import type { AnalyticsReport } from "./contracts";

export interface InsightState { report: AnalyticsReport | null; loading: boolean; error: string | null }

export function createInsightRequests(
  fetch: (query: UsageQuery, requestId: string) => Promise<AnalyticsReport>,
  receive: (state: InsightState) => void,
  cancelRemote: (requestId: string) => Promise<void> = async () => {},
) {
  let version = 0;
  let active: string | null = null;
  const cancel = () => {
    version += 1;
    const requestId = active;
    active = null;
    if (requestId) void Promise.resolve().then(() => cancelRemote(requestId)).catch(() => {});
  };
  const load = async (query: UsageQuery) => {
    cancel();
    const current = version;
    const requestId = crypto.randomUUID();
    active = requestId;
    receive({ report: null, loading: true, error: null });
    try {
      const report = await fetch(query, requestId);
      if (version === current) receive({ report, loading: false, error: null });
    } catch (error) {
      if (version === current) receive({ report: null, loading: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (version === current) active = null;
    }
  };
  return { load, cancel };
}
