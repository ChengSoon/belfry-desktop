import { invoke } from "@tauri-apps/api/core";
import type { AgentKind } from "../workspace/contracts";
import type { HistorySession } from "./contracts";

export function listHistory(agent: AgentKind) {
  return invoke<HistorySession[]>("history_list", { agent });
}

export function deleteHistorySession(agent: AgentKind, sessionId: string) {
  return invoke<void>("history_delete", { agent, sessionId });
}

export function clearHistory(agent: AgentKind) {
  return invoke<number>("history_clear", { agent });
}
