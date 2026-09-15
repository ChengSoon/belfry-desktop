import { useEffect, useMemo, useState } from "react";
import type { AgentSessionRef } from "../../agent/contracts";
import { toAppFailure } from "../../workspace/errors";
import type { DetailPage } from "./contracts";
import { cachePage } from "./model";
import { createDetailRequests } from "./requests";

interface State { owner: string; pages: DetailPage[]; active: number; busy: boolean; error: string | null }
const initial = (): State => ({ owner: "", pages: [], active: 0, busy: false, error: null });

export function useHistoryDetail(session: AgentSessionRef) {
  const owner = JSON.stringify([session.agent, session.id]);
  const [state, setState] = useState(initial);
  const requests = useMemo(() => createDetailRequests({
    start: (reset) => setState((current) => ({ ...(reset ? initial() : current), owner, busy: true, error: null })),
    result: (page) => setState((current) => ({ ...current, pages: cachePage(current.pages, page), active: page.page })),
    failure: (error) => setState((current) => ({ ...current, error: toAppFailure(error).message })),
    finish: () => setState((current) => ({ ...current, busy: false })),
  }), [session.agent, session.id]);
  useEffect(() => {
    void requests.open(session);
    return requests.dispose;
  }, [requests]);
  const page = state.owner === owner ? state.pages.find((page) => page.page === state.active) ?? null : null;
  const previous = () => setState((current) => ({ ...current, active: Math.max(current.pages[0]?.page ?? 0, current.active - 1) }));
  const next = () => {
    if (state.busy) return;
    if (state.pages.some((page) => page.page === state.active + 1)) setState((current) => ({ ...current, active: current.active + 1 }));
    else void requests.next();
  };
  return { page, busy: state.owner !== owner || state.busy, error: state.owner === owner ? state.error : null, hasPrevious: state.active > (state.pages[0]?.page ?? 0),
    earlierEvicted: (state.pages[0]?.page ?? 0) > 0, previous, next, reload: () => void requests.open(session) };
}
