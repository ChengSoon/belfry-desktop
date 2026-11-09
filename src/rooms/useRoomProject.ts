import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { t, useFeedback } from "../i18n";
import { openProject } from "../workspace/api";
import type { ProjectWorkspace } from "../workspace/contracts";

/** The dialog owns its selection; changing the active workspace must not replace it. */
export function useRoomProject(initial: ProjectWorkspace | null) {
  const [project, setProject] = useState(initial);
  const [path, setPath] = useState(initial?.rootPath ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const choosing = useRef(false);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const choose = async () => {
    if (choosing.current || !mounted.current) return;
    choosing.current = true;
    setBusy(true);
    try {
      const selected = await open({ directory: true, multiple: false, title: t("rooms.new.selectProject"),
        ...(project ? { defaultPath: project.rootPath } : {}) });
      // Cancelling preserves both the last selection and any validation failure.
      if (!mounted.current || typeof selected !== "string" || !selected.trim()) return;
      setPath(selected);
      setProject(null);
      setError(null);
      const resolved = await openProject(selected);
      if (mounted.current) { setProject(resolved); setPath(resolved.rootPath); }
    } catch (cause) {
      if (mounted.current) { setProject(null); setError(cause); }
    } finally {
      choosing.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return { project, path, busy, error, choose, canSubmit: project !== null && !busy && !error };
}
