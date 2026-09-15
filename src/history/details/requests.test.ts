import { beforeEach, expect, it, vi } from "vitest";
import { closeHistoryDetail, nextHistoryDetail, openHistoryDetail } from "./api";
import type { DetailPage } from "./contracts";
import { createDetailRequests } from "./requests";

vi.mock("./api", () => ({ closeHistoryDetail: vi.fn(), nextHistoryDetail: vi.fn(), openHistoryDetail: vi.fn() }));
const session = { agent: "codex" as const, id: "native" };
const page = (readerId: string, index = 0): DetailPage => ({ readerId, page: index, entries: [], hasMore: true, scannedBytes: 0, totalBytes: 100, skippedLines: 0, note: null });

function deferred() {
  let resolve!: (page: DetailPage) => void, reject!: (error: Error) => void;
  const promise = new Promise<DetailPage>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
function fixture() {
  const handlers = { start: vi.fn(), result: vi.fn(), failure: vi.fn(), finish: vi.fn() };
  return { ...handlers, ...createDetailRequests(handlers) };
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(closeHistoryDetail).mockResolvedValue(); });

it("切换会话只接收新结果，并在迟到的旧打开完成后再次释放读取器", async () => {
  const old = deferred(), current = deferred(), view = fixture();
  vi.mocked(openHistoryDetail).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const first = view.open(session), second = view.open({ ...session, id: "second" });
  const [oldId, currentId] = vi.mocked(openHistoryDetail).mock.calls.map(([id]) => id);
  current.resolve(page(currentId)); await second;
  old.resolve(page(oldId)); await first;
  expect(view.result.mock.calls).toEqual([[page(currentId)]]);
  expect(vi.mocked(closeHistoryDetail).mock.calls.filter(([id]) => id === oldId)).toHaveLength(2);
  expect(closeHistoryDetail).not.toHaveBeenCalledWith(currentId);
});

it("下一页不并发重复读取，失败后仍可重试同一页", async () => {
  const view = fixture();
  vi.mocked(openHistoryDetail).mockImplementation(async (id) => page(id));
  await view.open(session);
  const id = vi.mocked(openHistoryDetail).mock.calls[0][0];
  const pending = deferred(); vi.mocked(nextHistoryDetail).mockReturnValueOnce(pending.promise);
  const first = view.next(); await view.next();
  expect(nextHistoryDetail).toHaveBeenCalledTimes(1);
  pending.reject(new Error("读取失败")); await first;
  vi.mocked(nextHistoryDetail).mockResolvedValueOnce(page(id, 1)); await view.next();
  expect(vi.mocked(nextHistoryDetail).mock.calls).toEqual([[id, 1], [id, 1]]);
  expect(view.result).toHaveBeenLastCalledWith(page(id, 1));
});

it("关闭后的分页响应和错误都不会更新已离开的面板", async () => {
  const view = fixture(); vi.mocked(openHistoryDetail).mockImplementation(async (id) => page(id));
  await view.open(session); vi.clearAllMocks();
  const pending = deferred(); vi.mocked(nextHistoryDetail).mockReturnValue(pending.promise);
  const task = view.next(); view.dispose(); pending.reject(new Error("late")); await task;
  expect(view.failure).not.toHaveBeenCalled(); expect(view.result).not.toHaveBeenCalled();
  expect(view.finish).not.toHaveBeenCalled();
});

it("返回错误读取器或页码时显示错误，不能混入其他会话", async () => {
  const view = fixture(); vi.mocked(openHistoryDetail).mockResolvedValue(page("foreign"));
  await view.open(session);
  expect(view.result).not.toHaveBeenCalled();
  expect(view.failure.mock.calls[0][0].message).toContain("不一致");
});
