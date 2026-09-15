import { useCallback, useEffect, useRef, useState } from "react";
import { toAppFailure } from "../workspace/errors";
import { readGitStatus } from "./api";
import type { GitStatus } from "./contracts";

const REFRESH_INTERVAL_MS = 3_000;
interface State { rootPath: string | null; report: GitStatus | null; loading: boolean; failure: string | null }

export function useGitStatus(rootPath: string | null) {
  const [state, setState] = useState<State>({ rootPath, report: null, loading: false, failure: null });
  const loader = useRef<() => void>(() => {});
  useEffect(() => {
    setState({ rootPath, report: null, loading: Boolean(rootPath), failure: null });
    if (!rootPath) { loader.current = () => {}; return; }
    return pollStatus({ rootPath, loader, setState });
  }, [rootPath]);
  const reload = useCallback(() => loader.current(), []);
  const current = state.rootPath === rootPath ? state : { rootPath, report: null, loading: Boolean(rootPath), failure: null };
  return { ...current, reload };
}

function pollStatus({ rootPath, loader, setState }: {
  rootPath: string;
  loader: React.RefObject<() => void>;
  setState: React.Dispatch<React.SetStateAction<State>>;
}) {
  let active = true;
  let reading = false;
  const load = async () => {
    if (!active || reading) return;
    reading = true;
    setState((current) => ({ ...current, loading: true }));
    try {
      const report = await readGitStatus(rootPath);
      if (active) setState({ rootPath, report, loading: false, failure: null });
    } catch (error) {
      if (active) setState((current) => ({ ...current, loading: false, failure: toAppFailure(error).message }));
    } finally { reading = false; }
  };
  loader.current = () => void load();
  const onFocus = () => void load();
  const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, REFRESH_INTERVAL_MS);
  window.addEventListener("focus", onFocus);
  void load();
  return () => { active = false; loader.current = () => {}; window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
}
