import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openProject } from "../api";
import { normalizePath } from "../path";
import type { ProjectProfile } from "./contracts";
import { formatEnvironment, parseEnvironment, validateStartupCommand } from "./environment";
import { errorMessage } from "./storage";

interface Props { profile: ProjectProfile; onSave: (profile: ProjectProfile) => ProjectProfile; onGuard: (guarded: boolean) => void }

export function useProfileDraft({ profile, onSave, onGuard }: Props) {
  const [draft, setDraft] = useState(profile);
  const [environment, setEnvironment] = useState(() => formatEnvironment(profile.env));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile) || environment !== formatEnvironment(profile.env);
  useEffect(() => { onGuard(dirty || busy); return () => onGuard(false); }, [busy, dirty, onGuard]);
  const reset = () => { setDraft(profile); setEnvironment(formatEnvironment(profile.env)); setError(null); setNotice(null); };
  const save = () => {
    try {
      const saved = onSave({ ...draft, group: draft.group.trim(), command: validateStartupCommand(draft.command), env: parseEnvironment(environment) });
      setDraft(saved); setEnvironment(formatEnvironment(saved.env)); setError(null); setNotice("项目配置已保存，新建会话时生效");
    } catch (error) { setError(errorMessage(error)); }
  };
  const repair = async () => {
    setBusy(true); setError(null);
    try {
      const path = await openDialog({ directory: true, multiple: false, title: "重新选择项目目录", defaultPath: normalizePath(draft.project.rootPath) });
      if (typeof path === "string") {
        const project = await openProject(path);
        setDraft((current) => ({ ...current, project }));
        setNotice("保存后新会话使用此目录，运行中会话保持原目录");
      }
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  };
  return { draft, setDraft, environment, setEnvironment, error, notice, busy, dirty, reset, save, repair };
}

export function useDirectoryHealth(path: string) {
  const [health, setHealth] = useState<string | null | undefined>(undefined);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let active = true;
    setHealth(undefined);
    void openProject(path).then(() => { if (active) setHealth(null); })
      .catch((error) => { if (active) setHealth(errorMessage(error)); });
    return () => { active = false; };
  }, [generation, path]);
  return { health, check: () => setGeneration((value) => value + 1) };
}
