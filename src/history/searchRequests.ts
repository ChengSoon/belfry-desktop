import { cancelHistorySearch, searchHistory } from "./api";
import type { HistoryQuery, HistorySearchReport } from "./search";

interface Handlers {
  start: () => void;
  result: (report: HistorySearchReport) => void;
  failure: (error: unknown) => void;
  finish: () => void;
}

export function createHistoryRequests(handlers: Handlers) {
  let version = 0;
  let active: string | null = null;
  const cancel = () => {
    version += 1;
    const requestId = active;
    active = null;
    if (requestId) void cancelHistorySearch(requestId).catch(() => {});
  };
  const run = async (query: HistoryQuery) => {
    cancel();
    const current = ++version;
    const requestId = crypto.randomUUID();
    active = requestId;
    handlers.start();
    try {
      const report = await searchHistory({ query, requestId });
      if (version === current) handlers.result(report);
    } catch (error) {
      if (version === current) handlers.failure(error);
    } finally {
      if (version === current) { active = null; handlers.finish(); }
    }
  };
  return { run, cancel };
}
