import { useState } from "react";
import { exportBackupFile, importBackupFile } from "./api";
import { createBackup, parseBackup } from "./package";
import { backupStatus, cancelPendingBackup, scheduleRestore, scheduleUndo } from "./transaction";
import { message, type BackupDomain, type BackupPackage } from "./contracts";

export function useBackup() {
  const [preview, setPreview] = useState<BackupPackage | null>(null);
  const [domains, setDomains] = useState<BackupDomain[]>([]);
  const [status, setStatus] = useState(() => readStatus());
  const [error, setError] = useState<string | null>(status.error);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState(false);
  const run = async (action: () => void | Promise<void>) => {
    setBusy(true); setError(null); setNotice("");
    try { await action(); setStatus(readStatus()); } catch (error) { setError(message(error)); }
    finally { setBusy(false); }
  };
  const exportFile = () => run(async () => {
    const path = await exportBackupFile(JSON.stringify(createBackup(), null, 2));
    if (path) setNotice(`备份已保存：${path}`);
  });
  const importFile = () => run(async () => {
    const raw = await importBackupFile();
    if (raw === null) return;
    const next = parseBackup(raw);
    setPreview(next); setDomains(Object.keys(next.domains) as BackupDomain[]); setUndoConfirm(false);
  });
  const restore = () => run(() => {
    if (!preview) return;
    scheduleRestore({ backup: preview, domains }); setPreview(null);
    setNotice("已安排下次启动恢复。当前任务继续运行，退出前仍可取消。");
  });
  const undo = () => run(() => { scheduleUndo(); setUndoConfirm(false); });
  const cancel = () => run(() => { cancelPendingBackup(); setNotice("已取消恢复安排，现有配置不变。"); });
  const toggleDomain = (domain: BackupDomain) => setDomains((current) => current.includes(domain)
    ? current.filter((item) => item !== domain) : [...current, domain]);
  return { preview, domains, status, error, notice, busy, undoConfirm, setUndoConfirm,
    exportFile, importFile, restore, undo, cancel, toggleDomain, dismissPreview: () => setPreview(null) };
}

function readStatus() {
  try { return { ...backupStatus(), error: null }; }
  catch (error) { return { pending: null, undoAvailable: false, message: "", error: message(error) }; }
}
