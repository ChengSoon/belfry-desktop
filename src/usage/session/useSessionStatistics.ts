import { useEffect, useState } from "react";
import type { AgentSessionRef } from "../../agent/contracts";
import { EMPTY_STATISTICS, type StatisticsView } from "./contracts";
import { readSessionStatistics } from "./api";
import { watchStatistics } from "./polling";

interface Options { enabled: boolean; session: AgentSessionRef | null; transcriptPath: string | null }

export function useSessionStatistics({ enabled, session, transcriptPath }: Options) {
  const [state, setState] = useState<StatisticsView>(EMPTY_STATISTICS);
  useEffect(() => {
    if (!enabled || !session) { setState(EMPTY_STATISTICS); return; }
    return watchStatistics({ session, transcriptPath }, { read: readSessionStatistics, publish: setState });
  }, [enabled, session?.agent, session?.id, transcriptPath]);
  if (state.report && (state.report.session.id !== session?.id || state.report.session.agent !== session?.agent)) {
    return { ...EMPTY_STATISTICS, loading: enabled && Boolean(session) };
  }
  return state;
}
