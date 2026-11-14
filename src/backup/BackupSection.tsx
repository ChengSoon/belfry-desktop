import { errorMessage as localizedErrorMessage, formatDateTime, t, useTranslation } from "../i18n";
import { Download, Undo2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "../components/controls/Checkbox";
import { SButton, SGroupTitle, SItem, SList, STag } from "../settings/kit";
import { exportDiagnostics } from "../diagnostics/capture";
import { DOMAIN_LABELS, type BackupDomain } from "./contracts";
import { useBackup } from "./useBackup";
import "./backup.css";

/** 曜石稿（T19 backup）：导出 / 恢复两张动作卡，恢复预览是 group 内的复选行，已安排与撤回用 notice。 */
export function BackupSection({ onGuardChange }: { onGuardChange: (value: boolean) => void }) {
  useTranslation();
  const model = useBackup();
  useEffect(() => { onGuardChange(model.busy); return () => onGuardChange(false); }, [model.busy, onGuardChange]);
  // 稿（settings-v3/settings.html?page=data，T42）：说明一行 →「备份」组（导出 / 恢复 / 撤回）→「本地数据」组（导出诊断）。
  return <div className="backup-section">
    <p className="sk-lede">{t("backup.BackupSection.text_57c989aa14")}</p>
    <SGroupTitle>{t("backup.BackupSection.groupBackup")}</SGroupTitle>
    <SList>
      <SItem title={t("backup.BackupSection.text_e9d3dd690a")} hint={t("backup.BackupSection.text_1bc74d835a")}>
        <SButton tone="primary" disabled={model.busy} onClick={() => void model.exportFile()}><Download aria-hidden="true" />{t("backup.BackupSection.exportAction")}</SButton>
      </SItem>
      <SItem title={t("backup.BackupSection.restoreTitle")} hint={t("backup.BackupSection.restoreHint")}>
        <SButton tone="secondary" disabled={model.busy || !!model.status.pending} onClick={() => void model.importFile()}><Upload aria-hidden="true" />{t("backup.BackupSection.text_d8141c13fa")}</SButton>
      </SItem>
      {model.preview ? <BackupPreview model={model} /> : null}
      {model.status.pending ? <SItem className="backup-pending" title={<>{t("backup.BackupSection.text_795a160eb0")}{model.status.pending === "undo" ? t("backup.BackupSection.text_00587f201e") : t("backup.BackupSection.text_fc659e7d0f")}</>}
        hint={t("backup.BackupSection.text_2314b98c36")}>
        <STag tone="warn" dot>{t("backup.BackupSection.pendingTag")}</STag>
        <SButton disabled={model.busy} onClick={() => void model.cancel()}>{t("backup.BackupSection.text_bef0a2fc2e")}</SButton>
      </SItem> : null}
      {model.status.undoAvailable && !model.status.pending ? <SItem className="backup-undo" title={t("backup.BackupSection.text_bc7ccab2d2")}
        hint={model.undoConfirm ? t("backup.BackupSection.text_4ffbe20711") : model.status.message ?? undefined}>
        {model.undoConfirm ? <>
          <SButton onClick={() => model.setUndoConfirm(false)}>{t("backup.BackupSection.text_2cd0f3be87")}</SButton>
          <SButton tone="danger" disabled={model.busy} onClick={() => void model.undo()}>{t("backup.BackupSection.text_85e50d9577")}</SButton>
        </> : <SButton disabled={model.busy} onClick={() => model.setUndoConfirm(true)}><Undo2 aria-hidden="true" />{t("backup.BackupSection.undoAction")}</SButton>}
      </SItem> : null}
    </SList>
    {model.status.message && !(model.status.undoAvailable && !model.status.pending) ? <p className="sk-lede backup-note">{model.status.message}</p> : null}
    {model.notice ? <p className="sk-note" role="status">{model.notice}</p> : null}
    {model.error ? <p className="sk-note is-danger backup-error" role="alert">{model.error}</p> : null}
    <SGroupTitle>{t("backup.BackupSection.groupLocal")}</SGroupTitle>
    <SList>
      <DiagnosticsRow />
    </SList>
  </div>;
}

/** 导出诊断：日志与环境摘要（不含密钥），走现有 diagnostics_export。 */
function DiagnosticsRow() {
  useTranslation();
  const [state, setState] = useState<{ busy: boolean; result: string | null; error: string | null }>({ busy: false, result: null, error: null });
  return <SItem title={t("backup.BackupSection.diagnostics")} hint={state.error ?? state.result ?? t("backup.BackupSection.diagnosticsHint")}>
    <SButton tone="secondary" disabled={state.busy} onClick={() => {
      setState({ busy: true, result: null, error: null });
      void exportDiagnostics().then((output) => setState({ busy: false, result: t("backup.BackupSection.diagnosticsDone", { path: output.path }), error: null }))
        .catch((error: unknown) => setState({ busy: false, result: null, error: localizedErrorMessage(error) }));
    }}>{t("backup.BackupSection.diagnosticsAction")}</SButton>
  </SItem>;
}

/** 恢复预览：在「从备份恢复」行下方就地展开，选择数据域后安排下次启动恢复。 */
function BackupPreview({ model }: { model: ReturnType<typeof useBackup> }) {
  useTranslation();
  const backup = model.preview!;
  return <section className="sk-panel backup-preview" aria-label={t("backup.BackupSection.text_10328a6f1a")}>
    <h4>{t("backup.BackupSection.text_67ba5fe213")} · <time dateTime={backup.createdAt}>{formatDateTime(backup.createdAt, { dateStyle: "medium", timeStyle: "short" })}</time></h4>
    <div className="backup-domains">
      {(Object.keys(backup.domains) as BackupDomain[]).map((domain) => <div className="backup-domain" key={domain}>
        <Checkbox checked={model.domains.includes(domain)} onChange={() => model.toggleDomain(domain)} disabled={model.busy}>{DOMAIN_LABELS[domain]}</Checkbox>
        <small>{domain === "workspace" ? t("backup.BackupSection.text_d65252bffc", { length: backup.domains.workspace!.groups.workspaces.length, length2: backup.domains.workspace!.state.tabs.length })
          : t("backup.BackupSection.text_6b1a50a673")}</small>
      </div>)}
    </div>
    <p>{t("backup.BackupSection.text_9f9111c71d")}</p>
    <div className="sk-acts">
      <SButton disabled={model.busy} onClick={model.dismissPreview}>{t("backup.BackupSection.text_2cd0f3be87")}</SButton>
      <SButton tone="primary" disabled={model.busy || !model.domains.length} onClick={() => void model.restore()}>{t("backup.BackupSection.text_c533e05c9d")}</SButton>
    </div>
  </section>;
}
