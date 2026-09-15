import { afterEach, expect, it, vi } from "vitest";
import { watchStatistics } from "./polling";
import type { SessionStatistics, SessionStatisticsQuery, StatisticsView } from "./contracts";

const query: SessionStatisticsQuery = { session: { agent: "codex", id: "native-a" }, transcriptPath: null };
const report: SessionStatistics = { session: query.session, tokens: { input: 10, cachedInput: 20, cacheWrite: null, output: 4 },
  models: ["gpt-test"], currentModel: "gpt-test", tools: [], toolCount: 0, updatedAt: 1, observedAt: 1,
  sourceFiles: 1, scannedBytes: 100, pending: false, skippedLines: 0, note: null };
afterEach(() => vi.useRealTimers());

it("打开时读取，前一次完成后再轮询，关闭后停止", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValue(report);
  const publish = vi.fn();
  const stop = watchStatistics(query, { read, publish });
  await vi.advanceTimersByTimeAsync(0);
  expect(read).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenLastCalledWith({ report, loading: false, error: null });
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(2);
});

it("切换 tab 后，旧会话迟到的结果不能覆盖当前面板", async () => {
  vi.useFakeTimers();
  let resolveOld!: (report: SessionStatistics) => void;
  const publish = vi.fn();
  const stopOld = watchStatistics(query, { read: () => new Promise((resolve) => { resolveOld = resolve; }), publish });
  stopOld();
  const next = { ...report, session: { agent: "codex" as const, id: "native-b" } };
  const stopNew = watchStatistics({ ...query, session: next.session }, { read: vi.fn().mockResolvedValue(next), publish });
  await vi.advanceTimersByTimeAsync(0);
  resolveOld(report);
  await vi.advanceTimersByTimeAsync(0);
  expect(publish).toHaveBeenLastCalledWith({ report: next, loading: false, error: null });
  stopNew();
});

it("慢扫描不产生重叠请求，返回其他身份时明确报错", async () => {
  vi.useFakeTimers();
  let finish!: (report: SessionStatistics) => void;
  const read = vi.fn(() => new Promise<SessionStatistics>((resolve) => { finish = resolve; }));
  const states: StatisticsView[] = [];
  const stop = watchStatistics(query, { read, publish: (state) => states.push(state) });
  await vi.advanceTimersByTimeAsync(10000);
  expect(read).toHaveBeenCalledTimes(1);
  finish({ ...report, session: { agent: "claude", id: "native-a" } });
  await vi.advanceTimersByTimeAsync(0);
  expect(states.at(-1)?.report).toBeNull();
  expect(states.at(-1)?.error).toContain("身份");
  stop();
});

it("解析或读取失败显示错误，并继续尝试更新", async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error("日志暂不可读")).mockResolvedValue(report);
  const publish = vi.fn();
  const stop = watchStatistics(query, { read, publish });
  await vi.advanceTimersByTimeAsync(0);
  expect(publish.mock.calls.at(-1)?.[0].error).toContain("日志暂不可读");
  await vi.advanceTimersByTimeAsync(2000);
  expect(publish).toHaveBeenLastCalledWith({ report, loading: false, error: null });
  stop();
});
