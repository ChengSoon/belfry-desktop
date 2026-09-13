import { beforeEach, expect, it, vi } from "vitest";
import { cancelHistorySearch, searchHistory } from "./api";
import { createHistoryRequests } from "./searchRequests";
import { EMPTY_HISTORY_FILTERS, toHistoryQuery, type HistorySearchReport } from "./search";

vi.mock("./api", () => ({ searchHistory: vi.fn(), cancelHistorySearch: vi.fn() }));

const report = (project: string): HistorySearchReport => ({
  hits: [], projects: [project], scannedFiles: 1, indexedFiles: 1, skippedFiles: 0, skippedLines: 0,
});

function deferred() {
  let resolve!: (value: HistorySearchReport) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<HistorySearchReport>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const handlers = { start: vi.fn(), result: vi.fn(), failure: vi.fn(), finish: vi.fn() };
  const requests = createHistoryRequests(handlers);
  return { ...handlers, ...requests };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cancelHistorySearch).mockResolvedValue(undefined);
});

it("快速切换查询时只展示最新结果，并按身份取消旧请求", async () => {
  const old = deferred(); const current = deferred();
  vi.mocked(searchHistory).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const view = fixture();
  const first = view.run(toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, text: "旧查询" }));
  const second = view.run(toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, text: "新查询" }));
  const [oldId, currentId] = vi.mocked(searchHistory).mock.calls.map(([request]) => request.requestId);
  expect(oldId).not.toBe(currentId);
  expect(cancelHistorySearch).toHaveBeenCalledWith(oldId);
  current.resolve(report("新项目")); await second;
  old.resolve(report("旧项目")); await first;
  expect(view.result.mock.calls).toEqual([[report("新项目")]]);
  expect(view.finish).toHaveBeenCalledTimes(1);
});

it("卸载后迟到的错误和完成回调不能更新面板", async () => {
  const pending = deferred();
  vi.mocked(searchHistory).mockReturnValueOnce(pending.promise);
  const view = fixture();
  const task = view.run(toHistoryQuery(EMPTY_HISTORY_FILTERS));
  const requestId = vi.mocked(searchHistory).mock.calls[0][0].requestId;
  view.cancel();
  pending.reject(new Error("旧请求失败")); await task;
  expect(cancelHistorySearch).toHaveBeenCalledWith(requestId);
  expect(view.result).not.toHaveBeenCalled();
  expect(view.failure).not.toHaveBeenCalled();
  expect(view.finish).not.toHaveBeenCalled();
});

it("当前查询失败时显示错误并结束加载", async () => {
  const error = new Error("目录不可读");
  vi.mocked(searchHistory).mockRejectedValueOnce(error);
  const view = fixture();
  await view.run(toHistoryQuery(EMPTY_HISTORY_FILTERS));
  expect(view.failure).toHaveBeenCalledWith(error);
  expect(view.finish).toHaveBeenCalledTimes(1);
  view.cancel();
  expect(cancelHistorySearch).not.toHaveBeenCalled();
});
