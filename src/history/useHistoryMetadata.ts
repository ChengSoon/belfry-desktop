import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSessionRef } from "../agent/contracts";
import { HISTORY_METADATA_KEY, loadMetadata, saveSessionMetadata, type SessionMetadata } from "./metadata";

function readState() {
  try { return { entries: loadMetadata(localStorage), error: null as string | null }; }
  catch (error) { return { entries: {}, error: error instanceof Error ? error.message : "无法读取收藏。" }; }
}

export function useHistoryMetadata() {
  const [state, setState] = useState(readState);
  const save = useCallback((session: AgentSessionRef, patch: Partial<SessionMetadata>) => {
    try {
      const entries = saveSessionMetadata({ storage: localStorage, session, patch });
      setState({ entries, error: null });
      return true;
    } catch (error) {
      setState((current) => ({ ...current, error: error instanceof Error ? error.message : "收藏保存失败。" }));
      return false;
    }
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === HISTORY_METADATA_KEY || event.key === null) setState(readState());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const tags = useMemo(() => [...new Set(Object.values(state.entries).flatMap((item) => item.tags))]
    .sort((left, right) => left.localeCompare(right)), [state.entries]);
  return { ...state, save, tags };
}
