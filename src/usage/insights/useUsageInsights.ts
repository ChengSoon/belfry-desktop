import { useCallback, useEffect, useState } from "react";
import type { UsageWindow } from "../contracts";
import { cancelUsageAnalytics, fetchUsageAnalytics } from "./api";
import { createInsightRequests, type InsightState } from "./requests";

export function useUsageInsights(projectRoot: string | null) {
  const [state, setState] = useState<InsightState>({ report: null, loading: false, error: null });
  const [requests] = useState(() => createInsightRequests(fetchUsageAnalytics, setState, cancelUsageAnalytics));
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
