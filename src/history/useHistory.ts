import { useCallback, useEffect, useRef, useState } from "react";
import type { AppFailure } from "../workspace/contracts";
import { toAppFailure } from "../workspace/errors";
import { deleteHistorySession } from "./api";
import type { HistorySession } from "./contracts";
import type { HistoryQuery } from "./search";
import { sessionKey } from "./metadata";
import { useHistorySearch } from "./useHistorySearch";

export function useHistory(query: HistoryQuery | null) {
  const search = useHistorySearch(query);
  const mutations = useHistoryMutations(search.reload);
  return { ...search, ...mutations, failure: mutations.failure ?? search.failure };
}

function useHistoryMutations(reload: () => Promise<void>) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const remove = useCallback(async (sessions: readonly HistorySession[]) => {
    const targets = new Map(sessions.map((session) => [sessionKey(session.sessionRef), session]));
    setBusy(new Set(targets.keys())); setFailure(null);
    try {
      for (const session of targets.values()) await deleteHistorySession(session.agent, session.id);
    } catch (error) { if (mounted.current) setFailure(toAppFailure(error)); }
    finally {
      if (mounted.current) await reload();
      if (mounted.current) setBusy(new Set());
    }
  }, [reload]);
  return { busy, remove, failure };
}
