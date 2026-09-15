import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import type { AppFailure } from "../workspace/contracts";
import { createHistoryRequests } from "./searchRequests";
import type { HistoryQuery, HistorySearchReport } from "./search";

const SEARCH_DEBOUNCE_MS = 180;
const EMPTY_REPORT: HistorySearchReport = {
  hits: [], projects: [], scannedFiles: 0, indexedFiles: 0, skippedFiles: 0, skippedLines: 0,
};

export function useHistorySearch(query: HistoryQuery | null) {
  const [report, setReport] = useState(EMPTY_REPORT);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const requests = useMemo(() => createHistoryRequests({
    start: () => { setLoading(true); setFailure(null); },
    result: setReport,
    failure: (error) => setFailure(toAppFailure(error)),
    finish: () => setLoading(false),
  }), []);
  const load = useCallback(async () => {
    if (queryRef.current) await requests.run(queryRef.current);
  }, [requests]);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    requests.cancel();
    setReport((current) => ({ ...current, hits: [] }));
    setFailure(null);
    setLoading(queryKey !== "null");
    if (queryKey === "null") return;
    const timer = window.setTimeout(() => void load(), SEARCH_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); requests.cancel(); };
  }, [queryKey, requests, load]);
  return { report, loading, failure, reload: load };
}
