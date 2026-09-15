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

it("替换请求和关闭面板会取消对应后台请求，重复关闭不重复取消", async () => {
  const first = pending(), second = pending();
  const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const cancel = vi.fn().mockResolvedValue(undefined);
  const receive = vi.fn();
  const requests = createInsightRequests(fetch, receive, cancel);
  const a = requests.load(query);
  const firstId = fetch.mock.calls[0][1];
  const b = requests.load({ ...query, windowDays: 7 });
  const secondId = fetch.mock.calls[1][1];
  await Promise.resolve();
  expect(firstId).toEqual(expect.any(String));
  expect(secondId).not.toBe(firstId);
  expect(cancel).toHaveBeenCalledWith(firstId);
  requests.cancel(); requests.cancel();
  await Promise.resolve();
  expect(cancel.mock.calls).toEqual([[firstId], [secondId]]);
  const calls = receive.mock.calls.length;
  first.resolve(report("old")); second.reject(new Error("cancelled"));
  await Promise.all([a, b]);
  expect(receive).toHaveBeenCalledTimes(calls);
});

it("多个消费者使用独立 ID，取消失败不影响有效消费者", async () => {
  const first = pending(), second = pending();
  const fetch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const cancel = vi.fn().mockRejectedValue(new Error("transport closed"));
  const receive = vi.fn();
  const one = createInsightRequests(fetch, vi.fn(), cancel);
  const two = createInsightRequests(fetch, receive, cancel);
  const a = one.load(query), b = two.load(query);
  expect(fetch.mock.calls[0][1]).not.toBe(fetch.mock.calls[1][1]);
  one.cancel();
  first.reject(new Error("cancelled")); second.resolve(report("active"));
  await Promise.all([a, b]);
  expect(receive.mock.lastCall?.[0].report.projectRoot).toBe("active");
  two.cancel();
  await Promise.resolve();
  expect(cancel.mock.calls).toEqual([[fetch.mock.calls[0][1]]]);
});
