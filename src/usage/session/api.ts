import { invoke } from "@tauri-apps/api/core";
import type { SessionStatistics, SessionStatisticsQuery } from "./contracts";

export function readSessionStatistics(query: SessionStatisticsQuery) {
  return invoke<SessionStatistics>("session_statistics", { query });
}
