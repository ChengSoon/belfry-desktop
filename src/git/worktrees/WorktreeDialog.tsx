import { useFeedback, t, useTranslation } from "../../i18n";
import { GitBranch, Plus, RefreshCcw, X } from "lucide-react";
import { useState } from "react";
import { Notice } from "../../components/Notice";
import { createPortal } from "react-dom";
import { useDialog } from "../../components/controls/useDialog";
import { Disclosure } from "../../components/controls/Disclosure";
import { toAppFailure } from "../../workspace/errors";
import { CreateWorktree } from "./CreateWorktree";
import { WorktreeTask } from "./WorktreeTask";
import { useWorktrees } from "./useWorktrees";
import type { WorktreePreview } from "./contracts";
import "./worktrees.css";

interface Props { rootPath: string; onClose: () => void; onOpen: (path: string) => Promise<void> }

export function WorktreeDialog({ rootPath, onClose, onOpen }: Props) {
  useTranslation();
  const model = useWorktrees(rootPath);
  const [id, setId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useFeedback<string | null>(null);
  const busy = model.busy || opening;
  const ref = useDialog(onClose, busy);
  const selected = model.report?.managed.find((tree) => tree.id === id);
  const select = (id: string | null) => { model.clearPreview(); setId(id); setOpenError(null); };
  const open = async (path: string) => {
    setOpening(true); setOpenError(null);
    try { await onOpen(path); onClose(); } catch (error) { setOpenError(() => toAppFailure(error).message); }
    finally { setOpening(false); }
  };
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="worktree-dialog" role="dialog" aria-modal="true" aria-label={t("git.WorktreeDialog.text_b90a5bbd73")} ref={ref}>
      <header className="worktree-head"><div><h2>{t("git.WorktreeDialog.text_2a058ae758")}</h2><p>{t("git.WorktreeDialog.text_81a1a72ce9")}</p></div>
        <button type="button" aria-label={t("git.WorktreeDialog.text_174eb30f57")} disabled={busy} onClick={() => { model.clearPreview(); void model.refresh(); }}><RefreshCcw size={15} /></button>
        <button type="button" aria-label={t("git.WorktreeDialog.text_cf63ac3771")} disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <div className="worktree-body"><aside><button className="worktree-new" type="button" disabled={busy} onClick={() => select(null)}><Plus size={15} />{t("git.WorktreeDialog.text_6bee237280")}</button>
        <nav aria-label={t("git.WorktreeDialog.text_7e92bf96d4")}>{model.report?.managed.map((tree) => <button type="button" key={tree.id} disabled={busy} aria-current={tree.id === id} onClick={() => select(tree.id)}>
          <GitBranch size={14} /><span><strong>{tree.name}</strong><small>{tree.branch}</small></span></button>)}</nav>
      </aside><main>{model.error || openError ? <Notice className="worktree-error"
        action={model.error ? <button type="button" disabled={busy} onClick={() => { model.clearPreview(); void model.refresh(); }}>{t("git.WorktreeDialog.text_174eb30f57")}</button> : undefined}>
        {model.error ?? openError}</Notice> : null}
        {model.result ? <Notice className="worktree-result" tone={model.result.conflicts.length ? "warning" : "neutral"}
          action={model.result.worktree?.state === "ready" ? <button type="button" disabled={busy} onClick={() => select(model.result!.worktree!.id)}>{t("git.WorktreeDialog.text_36550b9c57")}</button> : undefined}>
          <p>{model.result.message}</p>
          {model.result.conflicts.length ? <ul>{model.result.conflicts.map((path) => <li key={path}>{path}</li>)}</ul> : null}</Notice> : null}
        {model.preview ? <Preview preview={model.preview} busy={busy} onBack={model.clearPreview} onExecute={model.execute} />
          : model.report ? selected ? <WorktreeTask key={selected.id} tree={selected} report={model.report} busy={busy} onOpen={open} onPreview={model.action} />
            : <CreateWorktree report={model.report} busy={busy} onPreview={model.create} />
          : <p role="status">{t("git.WorktreeDialog.text_f68ddc65ca")}</p>}
      </main></div>
    </section></div>, document.body);
}

function Preview({ preview, busy, onBack, onExecute }: { preview: WorktreePreview; busy: boolean; onBack: () => void; onExecute: () => Promise<void> }) {
  useTranslation();
  return <section className="worktree-confirm" aria-label={t("git.WorktreeDialog.text_5dc12ae108")}><h3>{preview.title}</h3>
    <dl><dt>{t("git.WorktreeDialog.text_e200ce5032")}</dt><dd>{preview.branch}</dd><dt>{t("git.WorktreeDialog.text_3db3334adb")}</dt><dd>{preview.rootPath}</dd>
      {preview.targetPath ? <><dt>{t("git.WorktreeDialog.text_26fa005acb")}</dt><dd>{preview.targetPath}</dd></> : null}</dl>
    {preview.notes.map((note) => <p key={note}>{note}</p>)}
    {preview.files.length ? <Disclosure title={t("git.WorktreeDialog.text_51bd6fddc8", { count: preview.files.length })} defaultOpen><ul>{preview.files.map((path) => <li key={path}>{path}</li>)}</ul></Disclosure> : null}
    {preview.diff ? <Disclosure title={t("git.WorktreeDialog.text_5676f96f45")} defaultOpen><pre tabIndex={0}>{preview.diff}</pre></Disclosure> : null}
    <footer><button type="button" disabled={busy} onClick={onBack}>{t("git.WorktreeDialog.text_3160fc9159")}</button>
      <button className="is-primary" type="button" disabled={busy} onClick={() => void onExecute()}>{busy ? t("git.WorktreeDialog.text_195f0f0497") : t("git.WorktreeDialog.text_68a35e2242")}</button></footer>
  </section>;
}
