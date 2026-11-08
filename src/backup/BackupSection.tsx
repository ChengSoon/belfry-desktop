import { formatDateTime, t, useTranslation } from "../i18n";
import { Download, Upload, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { Checkbox } from "../components/controls/Checkbox";
import { SettingsHeader } from "../settings/SettingsHeader";
import { DOMAIN_LABELS, type BackupDomain } from "./contracts";
import { useBackup } from "./useBackup";
import "./backup.css";

export function BackupSection({ onGuardChange }: { onGuardChange: (value: boolean) => void }) {
  useTranslation();
  const model = useBackup();
  useEffect(() => { onGuardChange(model.busy); return () => onGuardChange(false); }, [model.busy, onGuardChange]);
  return <section className="backup-section" aria-label={t("backup.BackupSection.text_daa0a5cd5b")}>
    <SettingsHeader
      actions={<>
        <button type="button" disabled={model.busy} onClick={() => void model.exportFile()}><Download size={16} />{t("backup.BackupSection.text_e9d3dd690a")}</button>
        <button type="button" disabled={model.busy || !!model.status.pending} onClick={() => void model.importFile()}><Upload size={16} />{t("backup.BackupSection.text_d8141c13fa")}</button>
      </>}
      description={t("backup.BackupSection.text_57c989aa14")}
      title={t("backup.BackupSection.text_daa0a5cd5b")}
    />
    <p className="backup-note">{t("backup.BackupSection.text_1bc74d835a")}</p>
    {model.status.pending ? <div className="backup-card" role="status">
      <strong>{t("backup.BackupSection.text_795a160eb0")}{model.status.pending === "undo" ? t("backup.BackupSection.text_00587f201e") : t("backup.BackupSection.text_fc659e7d0f")}</strong>
      <p>{t("backup.BackupSection.text_2314b98c36")}</p>
      <button type="button" disabled={model.busy} onClick={() => void model.cancel()}>{t("backup.BackupSection.text_bef0a2fc2e")}</button>
    </div> : null}
    {model.preview ? <BackupPreview model={model} /> : null}
    {model.status.undoAvailable && !model.status.pending ? <div className="backup-undo">
      <button type="button" disabled={model.busy} onClick={() => model.setUndoConfirm(true)}><Undo2 size={15} />{t("backup.BackupSection.text_bc7ccab2d2")}</button>
      {model.undoConfirm ? <div className="backup-card"><p>{t("backup.BackupSection.text_4ffbe20711")}</p>
        <div className="backup-actions"><button type="button" onClick={() => model.setUndoConfirm(false)}>{t("backup.BackupSection.text_2cd0f3be87")}</button>
          <button type="button" disabled={model.busy} onClick={() => void model.undo()}>{t("backup.BackupSection.text_85e50d9577")}</button></div></div> : null}
    </div> : null}
    {model.status.message ? <p className="backup-note">{model.status.message}</p> : null}
    {model.notice ? <p role="status">{model.notice}</p> : null}
    {model.error ? <p className="backup-error" role="alert">{model.error}</p> : null}
  </section>;
}

function BackupPreview({ model }: { model: ReturnType<typeof useBackup> }) {
  useTranslation();
  const backup = model.preview!;
  return <section className="backup-card" aria-label={t("backup.BackupSection.text_10328a6f1a")}><header><h3>{t("backup.BackupSection.text_67ba5fe213")}</h3>
    <time dateTime={backup.createdAt}>{formatDateTime(backup.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></header>
    {(Object.keys(backup.domains) as BackupDomain[]).map((domain) => <div className="backup-domain" key={domain}>
      <Checkbox checked={model.domains.includes(domain)} onChange={() => model.toggleDomain(domain)} disabled={model.busy}>{DOMAIN_LABELS[domain]}</Checkbox>
      <small>{domain === "workspace" ? t("backup.BackupSection.text_d65252bffc", { length: backup.domains.workspace!.groups.workspaces.length, length2: backup.domains.workspace!.state.tabs.length })
        : t("backup.BackupSection.text_6b1a50a673")}</small>
    </div>)}
    <p className="backup-note">{t("backup.BackupSection.text_9f9111c71d")}</p>
    <div className="backup-actions"><button type="button" disabled={model.busy} onClick={model.dismissPreview}>{t("backup.BackupSection.text_2cd0f3be87")}</button>
      <button className="is-primary" type="button" disabled={model.busy || !model.domains.length} onClick={() => void model.restore()}>{t("backup.BackupSection.text_c533e05c9d")}</button></div>
  </section>;
}
