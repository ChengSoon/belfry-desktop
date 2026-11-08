import { useFeedback, t, useTranslation } from "../i18n";
import { useState } from "react";
import { exportBackupFile, importBackupFile } from "./api";
import { createBackup, parseBackup } from "./package";
import { backupStatus, cancelPendingBackup, scheduleRestore, scheduleUndo } from "./transaction";
import { message, type BackupDomain, type BackupPackage } from "./contracts";

export function useBackup() {
  useTranslation();
  const [preview, setPreview] = useState<BackupPackage | null>(null);
  const [domains, setDomains] = useState<BackupDomain[]>([]);
  const [status, setStatus] = useState(() => readStatus());
  const [error, setError] = useFeedback<string | null>(status.error);
  const [notice, setNotice] = useFeedback("");
  const [busy, setBusy] = useState(false);
  const [undoConfirm, setUndoConfirm] = useState(false);
  const run = async (action: () => void | Promise<void>) => {
    setBusy(true); setError(null); setNotice("");
    try { await action(); setStatus(readStatus()); } catch (error) { setError(() => message(error)); }
    finally { setBusy(false); }
  };
  const exportFile = () => run(async () => {
    const path = await exportBackupFile(JSON.stringify(createBackup(), null, 2));
    if (path) setNotice(() => t("backup.useBackup.text_1db3acdaf5", { path: path }));
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
    setNotice(() => t("backup.useBackup.text_fbe9843884"));
  });
  const undo = () => run(() => { scheduleUndo(); setUndoConfirm(false); });
  const cancel = () => run(() => { cancelPendingBackup(); setNotice(() => t("backup.useBackup.text_33d06f64a5")); });
  const toggleDomain = (domain: BackupDomain) => setDomains((current) => current.includes(domain)
    ? current.filter((item) => item !== domain) : [...current, domain]);
  return { preview, domains, status, error, notice, busy, undoConfirm, setUndoConfirm,
    exportFile, importFile, restore, undo, cancel, toggleDomain, dismissPreview: () => setPreview(null) };
}

function readStatus() {
  try { return { ...backupStatus(), error: null }; }
  catch (error) { return { pending: null, undoAvailable: false, message: "", error: message(error) }; }
}
