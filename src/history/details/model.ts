import type { DetailPage, HistoryChange, HistoryEntry } from "./contracts";

export interface ChangeRecord {
  id: string; entryId: string; toolId: string; timestamp: number | null;
  change: HistoryChange; success: boolean | null; resultPresent: boolean; truncated: boolean;
}
const MAX_CACHED_PAGES = 32;
const MAX_CACHED_BYTES = 8 * 1024 * 1024;

export function pageChanges(entries: HistoryEntry[]): ChangeRecord[] {
  const results = new Map(entries.flatMap((entry) => entry.tools.filter((tool) => tool.kind === "result").map((tool) => [tool.id, tool] as const)));
  return entries.flatMap((entry) => entry.tools.filter((tool) => tool.kind === "call").flatMap((tool) =>
    tool.changes.map((change, index) => ({ id: JSON.stringify([entry.id, tool.id, index]), entryId: entry.id, toolId: tool.id,
      timestamp: entry.timestamp, change, success: results.get(tool.id)?.success ?? null,
      resultPresent: results.has(tool.id), truncated: entry.truncated }))));
}

export function resultLabel(record: Pick<ChangeRecord, "success" | "resultPresent">) {
  if (record.success === false) return "工具返回失败";
  if (record.success === true) return "工具返回成功";
  return record.resultPresent ? "执行状态未标明" : "本页未见执行结果";
}

export function cachePage(pages: DetailPage[], page: DetailPage) {
  const next = [...pages.filter((item) => item.page !== page.page), page].sort((left, right) => left.page - right.page);
  let bytes = next.reduce((sum, item) => sum + pageSize(item), 0);
  while (next.length > 1 && (next.length > MAX_CACHED_PAGES || bytes > MAX_CACHED_BYTES)) bytes -= pageSize(next.shift()!);
  return next;
}

function pageSize(page: DetailPage) { return JSON.stringify(page).length * 2; }
export function byteLabel(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function changeLabel(kind: string) {
  return ({ add: "新增", modify: "修改", edit: "替换", write: "写入", delete: "删除", rename: "重命名" } as Record<string, string>)[kind] ?? "修改";
}
