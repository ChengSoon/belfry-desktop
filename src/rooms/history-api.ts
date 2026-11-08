import { invoke } from "@tauri-apps/api/core";

export interface RoomHistoryEvent {
  v: number;
  id: string;
  ts: number;
  kind: string;
  room_id: string;
  by: string;
  data: unknown;
}

export interface RoomHistoryRecord {
  offset: string;
  bytes: number;
  event: RoomHistoryEvent | null;
  raw: string | null;
  truncated: boolean;
}

export interface RoomHistoryPage {
  entries: RoomHistoryRecord[];
  nextCursor: string | null;
  ledgerBytes: number;
  snapshotBytes: number;
}

/** First page: omit cursor. Later pages use nextCursor unchanged and contain older records. */
export function roomHistory(id: string, cursor: string | null = null, limit = 50) {
  return invoke<RoomHistoryPage>("room_history", { id, cursor, limit });
}
