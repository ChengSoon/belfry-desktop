import { GitBranch, Plus, RefreshCcw, X } from "lucide-react";
import { useState } from "react";
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
  const model = useWorktrees(rootPath);
  const [id, setId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const busy = model.busy || opening;
  const ref = useDialog(onClose, busy);
  const selected = model.report?.managed.find((tree) => tree.id === id);
  const select = (id: string | null) => { model.clearPreview(); setId(id); setOpenError(null); };
  const open = async (path: string) => {
    setOpening(true); setOpenError(null);
    try { await onOpen(path); onClose(); } catch (error) { setOpenError(toAppFailure(error).message); }
    finally { setOpening(false); }
  };
  return createPortal(<div className="modal-scrim" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section className="worktree-dialog" role="dialog" aria-modal="true" aria-label="Worktree 任务" ref={ref}>
      <header className="worktree-head"><div><h2>独立任务</h2><p>从分支开始，在审查后收尾。</p></div>
        <button type="button" aria-label="刷新 Worktree" disabled={busy} onClick={() => { model.clearPreview(); void model.refresh(); }}><RefreshCcw size={15} /></button>
        <button type="button" aria-label="关闭 Worktree" disabled={busy} onClick={onClose}><X size={17} /></button></header>
      <div className="worktree-body"><aside><button className="worktree-new" type="button" disabled={busy} onClick={() => select(null)}><Plus size={15} />新建任务</button>
        <nav aria-label="受管 Worktree">{model.report?.managed.map((tree) => <button type="button" key={tree.id} disabled={busy} aria-current={tree.id === id} onClick={() => select(tree.id)}>
          <GitBranch size={14} /><span><strong>{tree.name}</strong><small>{tree.branch}</small></span></button>)}</nav>
      </aside><main>{model.error || openError ? <p className="worktree-error" role="alert">{model.error ?? openError}</p> : null}
        {model.result ? <div className="worktree-result" role="status"><p>{model.result.message}</p>
          {model.result.conflicts.length ? <ul>{model.result.conflicts.map((path) => <li key={path}>{path}</li>)}</ul> : null}
          {model.result.worktree?.state === "ready" ? <button type="button" disabled={busy} onClick={() => select(model.result!.worktree!.id)}>查看任务</button> : null}</div> : null}
        {model.preview ? <Preview preview={model.preview} busy={busy} onBack={model.clearPreview} onExecute={model.execute} />
          : model.report ? selected ? <WorktreeTask key={selected.id} tree={selected} report={model.report} busy={busy} onOpen={open} onPreview={model.action} />
            : <CreateWorktree report={model.report} busy={busy} onPreview={model.create} />
          : <p role="status">正在读取工作树…</p>}
      </main></div>
    </section></div>, document.body);
}

function Preview({ preview, busy, onBack, onExecute }: { preview: WorktreePreview; busy: boolean; onBack: () => void; onExecute: () => Promise<void> }) {
  return <section className="worktree-confirm" aria-label="Worktree 操作预览"><h3>{preview.title}</h3>
    <dl><dt>任务分支</dt><dd>{preview.branch}</dd><dt>任务目录</dt><dd>{preview.rootPath}</dd>
      {preview.targetPath ? <><dt>目标目录</dt><dd>{preview.targetPath}</dd></> : null}</dl>
    {preview.notes.map((note) => <p key={note}>{note}</p>)}
    {preview.files.length ? <Disclosure title={`${preview.files.length} 个变更文件`} defaultOpen><ul>{preview.files.map((path) => <li key={path}>{path}</li>)}</ul></Disclosure> : null}
    {preview.diff ? <Disclosure title="审查 Diff" defaultOpen><pre tabIndex={0}>{preview.diff}</pre></Disclosure> : null}
    <footer><button type="button" disabled={busy} onClick={onBack}>返回修改</button>
      <button className="is-primary" type="button" disabled={busy} onClick={() => void onExecute()}>{busy ? "执行中…" : "确认执行"}</button></footer>
  </section>;
}
