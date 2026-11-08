import { t, useTranslation } from "../i18n";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentSessionRef } from "../agent/contracts";
import { HISTORY_METADATA_KEY, loadMetadata, saveSessionMetadata, type SessionMetadata } from "./metadata";

function readState(): { entries: ReturnType<typeof loadMetadata>; error: string | null } {
  try { return { entries: loadMetadata(localStorage), error: null as string | null }; }
  catch (error) { return { entries: {}, get error() { return error instanceof Error ? error.message : t("history.useHistoryMetadata.text_a43d2b0c29"); } }; }
}

export function useHistoryMetadata() {
  useTranslation();
  const [state, setState] = useState(readState);
  const save = useCallback((session: AgentSessionRef, patch: Partial<SessionMetadata>) => {
    try {
      const entries = saveSessionMetadata({ storage: localStorage, session, patch });
      setState({ entries, error: null });
      return true;
    } catch (error) {
      setState((current) => ({ ...current, get error() { return error instanceof Error ? error.message : t("history.useHistoryMetadata.text_6c9d7addda"); } }));
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
