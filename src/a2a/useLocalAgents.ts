import { useCallback, useEffect, useRef, useState } from "react";
import { useFeedback } from "../i18n";
import { listLocalAgents } from "./api";
import type { LocalDiscovery } from "./contracts";
import { a2aErrorMessage } from "./feedback";

export function useLocalAgents(rootPath: string) {
  const [discovery, setDiscovery] = useState<LocalDiscovery | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useFeedback<string | null>(null);
  const alive = useRef(true), sequence = useRef(0), pending = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; sequence.current++; pending.current = false; };
  }, [rootPath]);

  const refresh = useCallback(async () => {
    if (pending.current) return;
    const request = ++sequence.current;
    pending.current = true; setLoading(true);
    try {
      const value = await listLocalAgents(rootPath);
      if (alive.current && request === sequence.current) { setDiscovery(value); setFailure(null); }
    } catch (error) {
      if (alive.current && request === sequence.current) setFailure(() => a2aErrorMessage(error));
    } finally {
      if (alive.current && request === sequence.current) { pending.current = false; setLoading(false); }
    }
  }, [rootPath, setFailure]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { discovery, loading, failure, refresh };
}
