import { invoke } from "@tauri-apps/api/core";
import type { UsageQuery } from "../contracts";
import type { AnalyticsReport } from "./contracts";

export function fetchUsageAnalytics(query: UsageQuery, requestId: string) {
  return invoke<AnalyticsReport>("usage_analytics", { query, requestId });
}

export function cancelUsageAnalytics(requestId: string) {
  return invoke<void>("usage_cancel_analytics", { requestId });
}
