import { useCallback, useMemo, useState } from "react";
import type { HistorySession } from "./contracts";
import { sessionKey } from "./metadata";
import { EMPTY_HISTORY_FILTERS, filterHistoryMetadata, toHistoryQuery, type HistoryFilters } from "./search";
import { useHistory } from "./useHistory";
import { useHistoryMetadata } from "./useHistoryMetadata";

export const HISTORY_PAGE_SIZE = 80;

export function useHistoryPanel() {
  const [filters, setFilters] = useState(EMPTY_HISTORY_FILTERS);
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const [pendingDelete, setPendingDelete] = useState<HistorySession[] | null>(null);
  const query = useMemo(() => resolveQuery(filters), [filters]);
  const history = useHistory(query.value);
  const metadata = useHistoryMetadata();
  const hits = useMemo(() => query.error ? [] : filterHistoryMetadata({
    hits: history.report.hits, metadata: metadata.entries, filters,
  }), [history.report.hits, metadata.entries, filters, query.error]);
  const selection = useHistorySelection(hits.map((hit) => hit.session));
  const change = useCallback((patch: Partial<HistoryFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setLimit(HISTORY_PAGE_SIZE);
    selection.clear();
  }, [selection.clear]);
  const favorite = useCallback((session: HistorySession) => {
    const item = metadata.entries[sessionKey(session.sessionRef)];
    metadata.save(session.sessionRef, { favorite: !item?.favorite });
  }, [metadata.entries, metadata.save]);
  const confirmDelete = () => {
    const targets = pendingDelete;
    setPendingDelete(null); selection.clear();
    if (targets) void history.remove(targets);
  };
  return { filters, change, query, history, metadata, hits, visible: hits.slice(0, limit), selection,
    pendingDelete, setPendingDelete, confirmDelete, favorite,
    showMore: () => setLimit((current) => current + HISTORY_PAGE_SIZE),
    reset: () => change(EMPTY_HISTORY_FILTERS),
  };
}

function useHistorySelection(sessions: HistorySession[]) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const clear = useCallback(() => setSelected(new Set()), []);
  const toggle = useCallback((session: HistorySession) => {
    setSelected((current) => {
      const next = new Set(current);
      const key = sessionKey(session.sessionRef);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const selectedSessions = sessions.filter((session) => selected.has(sessionKey(session.sessionRef)));
  return { selecting, selected, selectedSessions, clear, toggle,
    toggleMode: () => { setSelecting((current) => !current); clear(); },
    toggleAll: () => setSelected(selectedSessions.length === sessions.length ? new Set()
      : new Set(sessions.map((session) => sessionKey(session.sessionRef)))),
  };
}

function resolveQuery(filters: HistoryFilters) {
  try { return { value: toHistoryQuery(filters), error: null }; }
  catch (error) { return { value: null, error: error instanceof Error ? error.message : "筛选条件无效。" }; }
}
