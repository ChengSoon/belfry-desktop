import type { TokenTotals } from "../contracts";
import { pathKey } from "../../workspace/path";
import { totalTokens } from "../format";
import type { AnalyticsReport, InsightFilter, UsageBucket } from "./contracts";

export const DAY_SECONDS = 86_400;
export const CHART_DAYS = 30;
export const dayLabel = (day: number) => new Date(day * 1000).toISOString().slice(0, 10);

export function filterRows(rows: UsageBucket[], filter: InsightFilter): UsageBucket[] {
  return rows.filter((row) => (filter.day === undefined || row.day === filter.day)
    && (filter.projectRoot === undefined || sameProject(row.projectRoot, filter.projectRoot)));
}

export function sameProject(left: string | null, right: string | null) {
  return left === null || right === null ? left === right : pathKey(left) === pathKey(right);
}

export function sumTokens(rows: UsageBucket[]): TokenTotals {
  return rows.reduce((sum, row) => ({
    input: sum.input + row.tokens.input,
    cachedInput: sum.cachedInput + row.tokens.cachedInput,
    cacheWrite: sum.cacheWrite + row.tokens.cacheWrite,
    output: sum.output + row.tokens.output,
  }), { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 });
}

function group(rows: UsageBucket[], key: (row: UsageBucket) => string) {
  const buckets = new Map<string, UsageBucket[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = buckets.get(id);
    if (bucket) bucket.push(row);
    else buckets.set(id, [row]);
  }
  return [...buckets].map(([id, values]) => ({ id, rows: values, tokens: sumTokens(values),
    requests: values.reduce((sum, row) => sum + row.requests, 0) }))
    .sort((left, right) => totalTokens(right.tokens) - totalTokens(left.tokens) || left.id.localeCompare(right.id));
}

export function groupModels(rows: UsageBucket[]) {
  return group(rows, (row) => JSON.stringify([row.agent, row.model]))
    .map((item) => ({ ...item, agent: item.rows[0].agent, model: item.rows[0].model }));
}

export function groupProjects(rows: UsageBucket[]) {
  return group(rows, (row) => JSON.stringify(row.projectRoot === null ? null : pathKey(row.projectRoot)))
    .map((item) => ({ ...item, root: item.rows[0].projectRoot, name: item.rows[0].projectName ?? "项目未知" }));
}

export function calendarPage(report: AnalyticsReport, rows: UsageBucket[], requested: number) {
  const today = Math.floor(report.generatedAt / DAY_SECONDS) * DAY_SECONDS;
  const first = report.startAt ?? rows.reduce((earliest, row) => row.day === null ? earliest : Math.min(earliest, row.day), today);
  const maxPage = Math.max(0, Math.ceil(((today - first) / DAY_SECONDS + 1) / CHART_DAYS) - 1);
  const page = Math.min(maxPage, Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0));
  const end = today - page * CHART_DAYS * DAY_SECONDS;
  const start = Math.max(first, end - (CHART_DAYS - 1) * DAY_SECONDS);
  const amounts = new Map<number, number>();
  for (const row of rows) {
    if (row.day !== null) amounts.set(row.day, (amounts.get(row.day) ?? 0) + totalTokens(row.tokens));
  }
  const bars = [];
  for (let day = start; day <= end; day += DAY_SECONDS) bars.push({ day, total: amounts.get(day) ?? 0 });
  return { page, bars, canPrevious: page < maxPage, canNext: page > 0 };
}
