import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../workspace/contracts";
import type { HistorySession } from "./contracts";
import type { HistoryQuery, HistorySearchReport } from "./search";

export function searchHistory(request: { query: HistoryQuery; requestId: string }) {
  return invoke<HistorySearchReport>("history_search", { request });
}

export function cancelHistorySearch(requestId: string) {
  return invoke<void>("history_cancel_search", { requestId });
}

export function listHistory(agent: AgentKind) {
  return invoke<HistorySession[]>("history_list", { agent });
}

export function deleteHistorySession(agent: AgentKind, sessionId: string) {
  return invoke<void>("history_delete", { agent, sessionId });
}

export function clearHistory(agent: AgentKind) {
  return invoke<number>("history_clear", { agent });
}
