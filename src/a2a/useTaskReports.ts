import { useEffect, useState } from "react";
import { localTaskSnapshot } from "./api";
import type { ProtocolTaskPreview } from "./contracts";

interface Snapshot { rootPath: string | null; tasks: ProtocolTaskPreview[]; error: unknown }
const empty: Snapshot = { rootPath: null, tasks: [], error: null };

/** One read per visible panel/project, never one timer per task. */
export function useTaskReports(rootPath: string | null) {
  const [snapshot, setSnapshot] = useState<Snapshot>(empty);
  useEffect(() => {
    if (!rootPath) return;
    let alive = true, pending = false;
    const refresh = async () => {
      if (!alive || pending) return;
      pending = true;
      try {
        const value = await localTaskSnapshot(rootPath);
        if (!value || !Array.isArray(value.tasks)) throw { code: "A2A_INVALID_RESPONSE" };
        if (alive) setSnapshot({ rootPath, tasks: value.tasks, error: null });
      } catch (error) {
        if (alive) setSnapshot(current => ({ rootPath, tasks: current.rootPath === rootPath ? current.tasks : [], error }));
      } finally { pending = false; }
    };
    void refresh();
    const whenVisible = () => { if (document.visibilityState !== "hidden") void refresh(); };
    const timer = window.setInterval(whenVisible, 5000);
    document.addEventListener("visibilitychange", whenVisible);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", whenVisible); };
  }, [rootPath]);
  // Hide the previous project's data synchronously, before the new IPC resolves.
  return snapshot.rootPath === rootPath ? snapshot : empty;
}
