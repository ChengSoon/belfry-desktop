import { formatNumber, t } from "../../i18n";
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
  if (record.success === false) return t("history.model.text_f9583ca5ee");
  if (record.success === true) return t("history.model.text_7263ac57a0");
  return record.resultPresent ? t("history.model.text_20fdb0b2a0") : t("history.model.text_34059d1f7c");
}

export function cachePage(pages: DetailPage[], page: DetailPage) {
  const next = [...pages.filter((item) => item.page !== page.page), page].sort((left, right) => left.page - right.page);
  let bytes = next.reduce((sum, item) => sum + pageSize(item), 0);
  while (next.length > 1 && (next.length > MAX_CACHED_PAGES || bytes > MAX_CACHED_BYTES)) bytes -= pageSize(next.shift()!);
  return next;
}

function pageSize(page: DetailPage) { return JSON.stringify(page).length * 2; }
export function byteLabel(bytes: number) {
  const options = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
  return bytes < 1024 * 1024 ? `${formatNumber(bytes / 1024, options)} KB` : `${formatNumber(bytes / (1024 * 1024), options)} MB`;
}
export function changeLabel(kind: string) {
  return ({ add: t("history.model.text_0006d696d8"), modify: t("history.model.text_37090f4565"), edit: t("history.model.text_131b13aa26"), write: t("history.model.text_5c783c4679"), delete: t("history.model.text_2f9daa8289"), rename: t("history.model.text_0d0cbac2ee") } as Record<string, string>)[kind] ?? t("history.model.text_37090f4565");
}
