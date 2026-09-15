import type { AgentSessionRef } from "../../agent/contracts";
import { closeHistoryDetail, nextHistoryDetail, openHistoryDetail } from "./api";
import type { DetailPage } from "./contracts";

interface Handlers {
  start: (reset: boolean) => void;
  result: (page: DetailPage) => void;
  failure: (error: unknown) => void;
  finish: () => void;
}

export function createDetailRequests(handlers: Handlers) {
  let active: string | null = null, version = 0, busy = false;
  let last: DetailPage | null = null;
  const dispose = () => {
    const id = active; version += 1; active = null; busy = false; last = null;
    if (id) void closeHistoryDetail(id).catch(() => {});
  };
  const run = async (request: { id: string; page: number; session?: AgentSessionRef }) => {
    const current = version; busy = true; handlers.start(request.page === 0);
    try {
      const result = request.session ? await openHistoryDetail(request.id, request.session) : await nextHistoryDetail(request.id, request.page);
      if (current !== version) return;
      if (result.readerId !== request.id || result.page !== request.page) throw new Error("返回的历史详情与当前请求不一致，请刷新重试");
      last = result; handlers.result(result);
    } catch (error) { if (current === version) handlers.failure(error); }
    finally {
      if (current === version) { busy = false; handlers.finish(); }
      else void closeHistoryDetail(request.id).catch(() => {});
    }
  };
  const open = (session: AgentSessionRef) => {
    dispose(); active = crypto.randomUUID();
    return run({ id: active, page: 0, session });
  };
  const next = async () => {
    if (busy || !active || !last?.hasMore) return;
    await run({ id: active, page: last.page + 1 });
  };
  return { open, next, dispose };
}
