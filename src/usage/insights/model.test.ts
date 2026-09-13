import { expect, it } from "vitest";
import { calendarPage, filterRows, groupModels, groupProjects, sumTokens } from "./model";
import type { AnalyticsReport, UsageBucket } from "./contracts";
import { totalTokens } from "../format";

const day = Date.parse("2026-09-12T00:00:00Z") / 1000;
const DAY = 86_400;
function row(patch: Partial<UsageBucket> = {}): UsageBucket {
  return { day, agent: "codex", model: "model-a", projectRoot: "/a", projectName: "A",
    requests: 1, tokens: { input: 1, cachedInput: 2, cacheWrite: 3, output: 4 }, ...patch };
}
function report(rows: UsageBucket[], patch: Partial<AnalyticsReport> = {}): AnalyticsReport {
  return { rows, quotas: [], scannedFiles: 1, skippedFiles: 0, undatedRecords: 0,
    generatedAt: day + 1, startAt: day - 6 * DAY, endAt: day + 2, projectRoot: null, windowDays: 7, ...patch };
}

it("日期与项目交叉下钻，共享同一批桶保证明细合计相等", () => {
  const rows = [row(), row({ day: day - DAY }), row({ projectRoot: "/b" }), row({ projectRoot: null }), row({ day: null })];
  expect(filterRows(rows, { day, projectRoot: "/a" })).toHaveLength(1);
  expect(filterRows(rows, { projectRoot: null })).toHaveLength(1);
  expect(filterRows(rows, { day: null })).toHaveLength(1);
  const total = totalTokens(sumTokens(rows));
  expect(groupModels(rows).reduce((sum, item) => sum + totalTokens(item.tokens), 0)).toBe(total);
  expect(groupProjects(rows).reduce((sum, item) => sum + totalTokens(item.tokens), 0)).toBe(total);
});

it("每日图表补零，UTC 今天在范围内且不分配未知日期", () => {
  const rows = [row(), row({ day: day - DAY }), row({ day: null })];
  const page = calendarPage(report(rows), rows, 0);
  expect(page.bars).toHaveLength(7);
  expect(page.bars[0]).toEqual({ day: day - 6 * DAY, total: 0 });
  expect(page.bars[6]).toEqual({ day, total: 10 });
  expect(page.bars.reduce((sum, bar) => sum + bar.total, 0)).toBe(20);
  expect(page.canPrevious).toBe(false);
  expect(page.canNext).toBe(false);
});

it("全历史以三十天分页，旧日期仍可下钻且越界页被收敛", () => {
  const rows = [row(), row({ day: day - 65 * DAY })];
  const all = report(rows, { startAt: null, windowDays: null });
  const first = calendarPage(all, rows, 0);
  const middle = calendarPage(all, rows, 1);
  const last = calendarPage(all, rows, 999);
  expect(first.bars).toHaveLength(30);
  expect(first.canPrevious).toBe(true);
  expect(middle.bars.at(-1)?.day).toBe(day - 30 * DAY);
  expect(last.bars[0].day).toBe(day - 65 * DAY);
  expect(last.canPrevious).toBe(false);
  expect(last.canNext).toBe(true);
  expect(last.bars.reduce((sum, bar) => sum + bar.total, 0)).toBe(10);
});

it("不同 Agent 和精确模型名保留独立分项", () => {
  const rows = [row(), row({ model: "model.a" }), row({ agent: "claude" })];
  expect(groupModels(rows)).toHaveLength(3);
});

it("Windows 同一路径的盘符大小写与分隔符不拆成多个项目", () => {
  const rows = [row({ projectRoot: "C:\\Work\\项目" }), row({ projectRoot: "c:/work/项目/" })];
  expect(groupProjects(rows)).toHaveLength(1);
  expect(filterRows(rows, { projectRoot: "C:/Work/项目" })).toHaveLength(2);
});
