import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";
import { applyHooks, cancelHookPreview, previewHooks, readHooks } from "./api";
import { toAppFailure } from "../../workspace/errors";

export function useHookSettings() {
  const [reports, setReports] = useState<AgentHookReport[]>([]);
  const [preview, setPreview] = useState<HookInstallPreview | null>(null);
  const { busy, error, setError, generation, perform } = useHookOperation();
  const previewRef = useRef(preview);
  previewRef.current = preview;

  const reload = useCallback(() => void perform(async (current) => {
    const reports = await readHooks();
    if (current === generation.current) setReports(reports);
  }), [perform]);

  useEffect(() => {
    reload();
    return () => {
      generation.current += 1;
      if (previewRef.current) void cancelHookPreview(previewRef.current.id).catch(() => {});
    };
  }, [reload]);

  const inspect = (kind: AgentKind, enabled: boolean) => void perform(async (current) => {
    const preview = await previewHooks(kind, enabled);
    if (current === generation.current) setPreview(preview);
    else void cancelHookPreview(preview.id).catch(() => {});
  });

  const confirm = () => void perform(async (current) => {
    if (!preview) return;
    try { await applyHooks(preview.id); }
    finally { if (current === generation.current) setPreview(null); }
    const reports = await readHooks();
    if (current === generation.current) setReports(reports);
  });

  const cancel = () => {
    if (preview) void cancelHookPreview(preview.id).catch(() => {});
    setPreview(null); setError(null);
  };
  return { reports, preview, busy, error, reload, inspect, confirm, cancel };
}

function useHookOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const perform = useCallback(async (action: (current: number) => Promise<void>) => {
    const current = ++generation.current;
    setBusy(true); setError(null);
    try { await action(current); }
    catch (error) { if (current === generation.current) setError(toAppFailure(error).message); }
    finally { if (current === generation.current) setBusy(false); }
  }, []);
  return { busy, error, setError, generation, perform };
}
