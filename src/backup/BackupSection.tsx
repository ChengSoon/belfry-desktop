import { Download, Upload, Undo2 } from "lucide-react";
import { useEffect } from "react";
import { Checkbox } from "../components/controls/Checkbox";
import { DOMAIN_LABELS, type BackupDomain } from "./contracts";
import { useBackup } from "./useBackup";
import "./backup.css";

export function BackupSection({ onGuardChange }: { onGuardChange: (value: boolean) => void }) {
  const model = useBackup();
  useEffect(() => { onGuardChange(model.busy); return () => onGuardChange(false); }, [model.busy, onGuardChange]);
  return <section className="backup-section" aria-label="本地备份">
    <header><h2>本地备份</h2><p>把工作区与外观带到下一次开始。</p></header>
    <div className="backup-actions">
      <button type="button" disabled={model.busy} onClick={() => void model.exportFile()}><Download size={16} />导出备份</button>
      <button type="button" disabled={model.busy || !!model.status.pending} onClick={() => void model.importFile()}><Upload size={16} />选择备份</button>
    </div>
    <p className="backup-note">包含会话目标、分组、布局、主题和显示参数。壁纸与字体文件需在本机导入；凭据、启动脚本、终端记录和插件数据不导出。</p>
    {model.status.pending ? <div className="backup-card" role="status">
      <strong>下次启动将{model.status.pending === "undo" ? "撤回恢复" : "恢复所选数据"}</strong>
      <p>当前任务继续运行。按平常方式退出并重新打开 Belfry 后生效。</p>
      <button type="button" disabled={model.busy} onClick={() => void model.cancel()}>取消安排</button>
    </div> : null}
    {model.preview ? <BackupPreview model={model} /> : null}
    {model.status.undoAvailable && !model.status.pending ? <div className="backup-undo">
      <button type="button" disabled={model.busy} onClick={() => model.setUndoConfirm(true)}><Undo2 size={15} />撤回最近一次恢复</button>
      {model.undoConfirm ? <div className="backup-card"><p>下次启动恢复到导入前的配置，仅影响上次选择的数据域。之后对这些数据域所做的修改也会被替换。</p>
        <div className="backup-actions"><button type="button" onClick={() => model.setUndoConfirm(false)}>取消</button>
          <button type="button" disabled={model.busy} onClick={() => void model.undo()}>安排撤回</button></div></div> : null}
    </div> : null}
    {model.status.message ? <p className="backup-note">{model.status.message}</p> : null}
    {model.notice ? <p role="status">{model.notice}</p> : null}
    {model.error ? <p className="backup-error" role="alert">{model.error}</p> : null}
  </section>;
}

function BackupPreview({ model }: { model: ReturnType<typeof useBackup> }) {
  const backup = model.preview!;
  return <section className="backup-card" aria-label="恢复预览"><header><h3>选择要恢复的内容</h3>
    <time dateTime={backup.createdAt}>{new Date(backup.createdAt).toLocaleString()}</time></header>
    {(Object.keys(backup.domains) as BackupDomain[]).map((domain) => <div className="backup-domain" key={domain}>
      <Checkbox checked={model.domains.includes(domain)} onChange={() => model.toggleDomain(domain)} disabled={model.busy}>{DOMAIN_LABELS[domain]}</Checkbox>
      <small>{domain === "workspace" ? `${backup.domains.workspace!.groups.workspaces.length} 个工作区 · ${backup.domains.workspace!.state.tabs.length} 条会话`
        : "主题、系统字体、字号与背景显示参数；保留本机壁纸和字体库"}</small>
    </div>)}
    <p className="backup-note">所选内容将在下次启动替换当前配置，恢复前会自动保存快照。工作区会按会话目标重新打开；目录失效时可在工作区中修复。</p>
    <div className="backup-actions"><button type="button" disabled={model.busy} onClick={model.dismissPreview}>取消</button>
      <button className="is-primary" type="button" disabled={model.busy || !model.domains.length} onClick={() => void model.restore()}>安排下次启动恢复</button></div>
  </section>;
}
