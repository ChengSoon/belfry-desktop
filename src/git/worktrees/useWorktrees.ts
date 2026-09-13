import { useCallback, useEffect, useRef, useState } from "react";
import { toAppFailure } from "../../workspace/errors";
import * as api from "./api";
import type { ActionInput, ActionResult, CreateInput, WorktreePreview, WorktreeReport } from "./contracts";

export function useWorktrees(rootPath: string) {
  const [report, setReport] = useState<WorktreeReport | null>(null);
  const [preview, setPreview] = useState<WorktreePreview | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false), generation = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++generation.current;
    try { const next = await api.listWorktrees(rootPath); if (version === generation.current) { setReport(next); setError(null); } }
    catch (error) { if (version === generation.current) setError(toAppFailure(error).message); }
  }, [rootPath]);
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [refresh]);
  const run = async (action: () => Promise<WorktreePreview | ActionResult>, execute = false) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setResult(null);
    const version = generation.current;
    try {
      const value = await action();
      if (version !== generation.current) return;
      if (execute) { setPreview(null); setResult(value as ActionResult); await refresh(); }
      else setPreview(value as WorktreePreview);
    } catch (error) { if (version === generation.current) { setPreview(null); setError(toAppFailure(error).message); } }
    finally { locked.current = false; setBusy(false); }
  };
  return { report, preview, result, error, busy, refresh,
    create: (input: CreateInput) => run(() => api.previewCreate(input)),
    action: (input: ActionInput) => run(() => api.previewAction(input)),
    execute: () => preview ? run(() => api.executeWorktree(preview.token), true) : Promise.resolve(),
    clearPreview: () => setPreview(null),
  };
}
