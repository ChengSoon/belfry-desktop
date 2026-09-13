export interface HistoryChange {
  path: string;
  originalPath: string | null;
  kind: string;
  oldText: string | null;
  newText: string | null;
  patch: string | null;
  note: string;
}
export interface HistoryTool {
  id: string;
  name: string;
  kind: "call" | "result";
  text: string;
  success: boolean | null;
  changes: HistoryChange[];
}
export interface HistoryEntry {
  id: string;
  role: string;
  timestamp: number | null;
  text: string;
  tools: HistoryTool[];
  omittedBlocks: number;
  truncated: boolean;
}
export interface DetailPage {
  readerId: string;
  page: number;
  entries: HistoryEntry[];
  hasMore: boolean;
  scannedBytes: number;
  totalBytes: number;
  skippedLines: number;
  note: string | null;
}
