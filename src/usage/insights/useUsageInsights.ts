import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { UsageQuery, UsageWindow } from "../contracts";
import type { AnalyticsReport } from "./contracts";
import { createInsightRequests, type InsightState } from "./requests";

const fetch = (query: UsageQuery) => invoke<AnalyticsReport>("usage_analytics", { query });

export function useUsageInsights(projectRoot: string | null) {
  const [state, setState] = useState<InsightState>({ report: null, loading: false, error: null });
  const [requests] = useState(() => createInsightRequests(fetch, setState));
  const [windowDays, setWindowDays] = useState<UsageWindow>(30);
  const [scoped, setScoped] = useState(false);
  const scope = scoped ? projectRoot : null;
  const reload = useCallback(() => requests.load({ windowDays, projectRoot: scope }), [requests, windowDays, scope]);
  useEffect(() => {
    void reload();
    return requests.cancel;
  }, [reload, requests]);
  useEffect(() => { if (!projectRoot) setScoped(false); }, [projectRoot]);
  return { ...state, windowDays, setWindowDays, scoped, setScoped, reload, canScope: Boolean(projectRoot) };
}
