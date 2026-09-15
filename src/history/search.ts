import type { AgentKind } from "../agent/contracts";
import type { HistorySession } from "./contracts";
import { sessionKey, type HistoryMetadata } from "./metadata";

const MILLISECONDS_PER_SECOND = 1_000;
export const HISTORY_QUERY_LIMIT = 256;

export interface HistoryQuery {
  agent: AgentKind | null;
  text: string;
  projectRoot: string | null;
  from: number | null;
  until: number | null;
}

export interface HistorySearchHit { session: HistorySession; snippet: string | null }
export interface HistorySearchReport {
  hits: HistorySearchHit[];
  projects: string[];
  scannedFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  skippedLines: number;
}

export interface HistoryFilters {
  agent: AgentKind | "all";
  text: string;
  project: string;
  startDate: string;
  endDate: string;
  favoriteOnly: boolean;
  tag: string;
}

export const EMPTY_HISTORY_FILTERS: HistoryFilters = {
  agent: "all", text: "", project: "", startDate: "", endDate: "", favoriteOnly: false, tag: "",
};

export function toHistoryQuery(filters: HistoryFilters): HistoryQuery {
  const from = dateBoundary(filters.startDate, false);
  const until = dateBoundary(filters.endDate, true);
  if (from !== null && until !== null && from >= until) throw new Error("开始日期不能晚于结束日期。");
  return {
    agent: filters.agent === "all" ? null : filters.agent,
    text: filters.text.trim(),
    projectRoot: filters.project || null,
    from,
    until,
  };
}

export function filterHistoryMetadata({ hits, metadata, filters }: {
  hits: HistorySearchHit[];
  metadata: HistoryMetadata;
  filters: Pick<HistoryFilters, "favoriteOnly" | "tag">;
}): HistorySearchHit[] {
  const tag = filters.tag.toLocaleLowerCase();
  return hits.filter(({ session }) => {
    const item = metadata[sessionKey(session.sessionRef)];
    return (!filters.favoriteOnly || item?.favorite === true)
      && (!tag || item?.tags.some((value) => value.toLocaleLowerCase() === tag));
  });
}

export function highlightedParts(text: string, query: string): { text: string; match: boolean }[] {
  const needle = query.trim();
  if (!needle) return [{ text, match: false }];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const parts: { text: string; match: boolean }[] = [];
  let offset = 0;
  for (const hit of text.matchAll(pattern)) {
    if (hit.index > offset) parts.push({ text: text.slice(offset, hit.index), match: false });
    parts.push({ text: hit[0], match: true });
    offset = hit.index + hit[0].length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset), match: false });
  return parts;
}

function dateBoundary(value: string, nextDay: boolean): number | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("请输入有效日期。");
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("请输入有效日期。");
  }
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.getTime() / MILLISECONDS_PER_SECOND;
}
