import { formatDateTime, t, useTranslation } from "../i18n";
import { Download, Undo2, Upload } from "lucide-react";
import { useEffect } from "react";
import { Checkbox } from "../components/controls/Checkbox";
import { Notice } from "../components/Notice";
import { SettingsHeader } from "../settings/SettingsHeader";
import { DOMAIN_LABELS, type BackupDomain } from "./contracts";
import { useBackup } from "./useBackup";
import "../settings/obsidianSections.css";
import "./backup.css";

/** 曜石稿（T19 backup）：导出 / 恢复两张动作卡，恢复预览是 group 内的复选行，已安排与撤回用 notice。 */
export function BackupSection({ onGuardChange }: { onGuardChange: (value: boolean) => void }) {
  useTranslation();
  const model = useBackup();
  useEffect(() => { onGuardChange(model.busy); return () => onGuardChange(false); }, [model.busy, onGuardChange]);
  return <section className="backup-section os-page" aria-label={t("backup.BackupSection.text_daa0a5cd5b")}>
    <SettingsHeader description={t("backup.BackupSection.text_57c989aa14")} title={t("backup.BackupSection.text_daa0a5cd5b")} />
    <div className="os-split">
      <div className="os-action-card">
        <span className="os-ico"><Download aria-hidden="true" /></span>
        <b>{t("backup.BackupSection.text_e9d3dd690a")}</b>
        <p>{t("backup.BackupSection.text_1bc74d835a")}</p>
        <button className="os-btn primary" type="button" disabled={model.busy} onClick={() => void model.exportFile()}>{t("backup.BackupSection.text_e9d3dd690a")}</button>
      </div>
      <div className="os-action-card">
        <span className="os-ico"><Upload aria-hidden="true" /></span>
        <b>{t("backup.BackupSection.restoreTitle")}</b>
        <p>{t("backup.BackupSection.restoreHint")}</p>
        <button className="os-btn secondary" type="button" disabled={model.busy || !!model.status.pending} onClick={() => void model.importFile()}>{t("backup.BackupSection.text_d8141c13fa")}</button>
      </div>
    </div>
    {model.preview ? <BackupPreview model={model} /> : null}
    {model.status.pending ? <Notice className="backup-pending" tone="warning"
      action={<button type="button" disabled={model.busy} onClick={() => void model.cancel()}>{t("backup.BackupSection.text_bef0a2fc2e")}</button>}>
      <strong>{t("backup.BackupSection.text_795a160eb0")}{model.status.pending === "undo" ? t("backup.BackupSection.text_00587f201e") : t("backup.BackupSection.text_fc659e7d0f")}</strong>
      {t("backup.BackupSection.text_2314b98c36")}
    </Notice> : null}
    {model.status.undoAvailable && !model.status.pending ? <Notice className="backup-undo" tone="neutral"
      action={model.undoConfirm ? <>
        <button type="button" onClick={() => model.setUndoConfirm(false)}>{t("backup.BackupSection.text_2cd0f3be87")}</button>
        <button type="button" disabled={model.busy} onClick={() => void model.undo()}>{t("backup.BackupSection.text_85e50d9577")}</button>
      </> : <button type="button" disabled={model.busy} onClick={() => model.setUndoConfirm(true)}><Undo2 aria-hidden="true" size={14} />{t("backup.BackupSection.text_bc7ccab2d2")}</button>}>
      <strong>{t("backup.BackupSection.text_bc7ccab2d2")}</strong>
      {model.undoConfirm ? t("backup.BackupSection.text_4ffbe20711") : null}
    </Notice> : null}
    {model.status.message ? <p className="backup-note">{model.status.message}</p> : null}
    {model.notice ? <Notice tone="neutral" role="status">{model.notice}</Notice> : null}
    {model.error ? <Notice className="backup-error" role="alert">{model.error}</Notice> : null}
  </section>;
}

function BackupPreview({ model }: { model: ReturnType<typeof useBackup> }) {
  useTranslation();
  const backup = model.preview!;
  return <section className="os-section" aria-label={t("backup.BackupSection.text_10328a6f1a")}>
    <div className="os-group-head"><h3>{t("backup.BackupSection.text_67ba5fe213")}</h3>
      <time className="os-meta" dateTime={backup.createdAt}>{formatDateTime(backup.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></div>
    <div className="os-group">
      {(Object.keys(backup.domains) as BackupDomain[]).map((domain) => <div className="os-choice backup-domain" key={domain}>
        <Checkbox checked={model.domains.includes(domain)} onChange={() => model.toggleDomain(domain)} disabled={model.busy}>{DOMAIN_LABELS[domain]}</Checkbox>
        <small>{domain === "workspace" ? t("backup.BackupSection.text_d65252bffc", { length: backup.domains.workspace!.groups.workspaces.length, length2: backup.domains.workspace!.state.tabs.length })
          : t("backup.BackupSection.text_6b1a50a673")}</small>
      </div>)}
    </div>
    <p className="backup-note">{t("backup.BackupSection.text_9f9111c71d")}</p>
    <div className="os-actions">
      <button className="os-btn" type="button" disabled={model.busy} onClick={model.dismissPreview}>{t("backup.BackupSection.text_2cd0f3be87")}</button>
      <button className="os-btn primary" type="button" disabled={model.busy || !model.domains.length} onClick={() => void model.restore()}>{t("backup.BackupSection.text_c533e05c9d")}</button>
    </div>
  </section>;
}
