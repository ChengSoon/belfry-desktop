import { invoke } from "@tauri-apps/api/core";
import type { AgentSessionRef } from "../../agent/contracts";
import type { DetailPage } from "./contracts";

export function openHistoryDetail(readerId: string, session: AgentSessionRef) {
  return invoke<DetailPage>("history_detail_open", { request: { readerId, session } });
}
export function nextHistoryDetail(readerId: string, page: number) {
  return invoke<DetailPage>("history_detail_next", { readerId, page });
}
export function closeHistoryDetail(readerId: string) {
  return invoke<void>("history_detail_close", { readerId });
}
