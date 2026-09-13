import type { SessionStatistics, SessionStatisticsQuery, StatisticsView } from "./contracts";
import { toAppFailure } from "../../workspace/errors";

interface Dependencies {
  read: (query: SessionStatisticsQuery) => Promise<SessionStatistics>;
  publish: (state: StatisticsView) => void;
}

const REFRESH_INTERVAL_MS = 2000;

export function watchStatistics(query: SessionStatisticsQuery, dependencies: Dependencies): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let report: SessionStatistics | null = null;
  dependencies.publish({ report: null, loading: true, error: null });
  const poll = async () => {
    try {
      const next = await dependencies.read(query);
      if (stopped) return;
      if (next.session.agent !== query.session.agent || next.session.id !== query.session.id) {
        throw new Error("统计结果的会话身份不匹配，已忽略");
      }
      report = next;
      dependencies.publish({ report, loading: false, error: null });
    } catch (error) {
      if (!stopped) dependencies.publish({ report, loading: false, error: toAppFailure(error).message });
    } finally {
      if (!stopped) timer = setTimeout(() => void poll(), REFRESH_INTERVAL_MS);
    }
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
