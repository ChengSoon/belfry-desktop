import { expect, it, vi } from "vitest";
import { createInsightRequests } from "./requests";
import type { AnalyticsReport } from "./contracts";

function pending() {
  let resolve!: (value: AnalyticsReport) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<AnalyticsReport>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const query = { windowDays: 30, projectRoot: null };
const report = (name: string) => ({ projectRoot: name } as AnalyticsReport);

it("快速切换范围时迟到结果与错误都不能污染当前视图", async () => {
  const first = pending(), second = pending(), third = pending();
  const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
  const receive = vi.fn();
  const requests = createInsightRequests(fetch, receive);
  const a = requests.load(query), b = requests.load({ ...query, windowDays: 7 });
  second.resolve(report("new")); await b;
  first.resolve(report("old")); await a;
  expect(receive.mock.lastCall?.[0].report.projectRoot).toBe("new");
  const c = requests.load(query);
  requests.cancel();
  const calls = receive.mock.calls.length;
  third.reject(new Error("late error")); await c;
  expect(receive).toHaveBeenCalledTimes(calls);
});

it("每次新范围清空旧数据，扫描失败明确显示错误", async () => {
  const receive = vi.fn();
  const requests = createInsightRequests(async () => { throw new Error("scan failed"); }, receive);
  await requests.load(query);
  expect(receive.mock.calls[0][0]).toEqual({ report: null, loading: true, error: null });
  expect(receive.mock.lastCall?.[0]).toEqual({ report: null, loading: false, error: "scan failed" });
});
