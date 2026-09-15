import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceTab } from "./contracts";
import { saveWorkspaceState, serializeWorkspaceState } from "./storage";

interface PersistenceOptions { tabs: WorkspaceTab[]; activeTabId: string | null; ready: boolean }

export function useWorkspacePersistence({ tabs, activeTabId, ready }: PersistenceOptions) {
  const lastPersisted = useRef<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  // phase/activity/error 不进入存档，终端刷屏不会重复写 localStorage。
  const serialized = serializeWorkspaceState(tabs, activeTabId);
  useEffect(() => {
    if (!ready || serialized === lastPersisted.current) return;
    const error = saveWorkspaceState(tabs, activeTabId);
    setPersistenceError(error);
    if (!error) lastPersisted.current = serialized;
  }, [activeTabId, ready, retry, serialized, tabs]);
  const retryPersistence = useCallback(() => setRetry((value) => value + 1), []);
  return { persistenceError, retryPersistence };
}
