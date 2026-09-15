import { useMemo, useRef, useState } from "react";
import type { AppFailure, WorkspaceTab } from "./contracts";
import { configureRestoredTabs } from "./projects/launch";
import { loadWorkspaceState } from "./storage";

/** 恢复只发生在挂载时，运行快照不会重新生成启动意图。 */
export function useWorkspaceState() {
  const restoredWorkspace = useMemo(() => {
    const saved = loadWorkspaceState();
    return saved ? { ...saved, tabs: configureRestoredTabs(saved.tabs) } : null;
  }, []);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => restoredWorkspace?.tabs ?? []);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [opening, setOpening] = useState(true);
  const [readyToPersist, setReadyToPersist] = useState(restoredWorkspace !== null);
  const requestVersion = useRef(0);
  return { restoredWorkspace, tabs, setTabs, failure, setFailure, opening, setOpening,
    readyToPersist, setReadyToPersist, requestVersion };
}

export type WorkspaceState = ReturnType<typeof useWorkspaceState>;
