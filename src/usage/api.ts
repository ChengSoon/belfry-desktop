import { invoke } from "@tauri-apps/api/core";
import type { UsageQuery, UsageReport } from "./contracts";

export function fetchUsageReport(query: UsageQuery) {
  return invoke<UsageReport>("usage_report", { query });
}
