import { FileSearch, GitBranch, RefreshCcw, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { FILE_PREVIEW_WIDTH } from "../filepreview/filePreviewWidth";
import { PanelResizeHandle } from "../panel/PanelResizeHandle";
import { usePanelWidth } from "../panel/usePanelWidth";
import { ICON } from "../theme/sizing";
import type { ProjectWorkspace } from "../workspace/contracts";
import type { GitFileTarget, GitStatus } from "./contracts";
import { GitFileList } from "./GitFileList";
import { GitDiffView } from "./GitDiffView";
import { useGitPanel } from "./useGitPanel";
import "../filepreview/filePreview.css";
import "./git.css";
import { WorktreeDialog } from "./worktrees/WorktreeDialog";

interface Props {
  project: ProjectWorkspace | null;
  failure?: string | null;
  onClose: () => void;
  onFiles: () => void;
  onOpenFile: (target: GitFileTarget) => void;
  onOpenProject?: (path: string) => Promise<void>;
}

export function GitPanel(props: Props) {
  const model = useGitPanel(props.project?.rootPath ?? null);
  const width = usePanelWidth(FILE_PREVIEW_WIDTH);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const report = model.status.report;
  const open = (path: string) => { if (report) props.onOpenFile({ rootPath: report.rootPath, path }); };
  return <section className="file-preview-panel git-panel" aria-label="Git 变更" style={{ "--file-preview-width": `${width.width}px` } as CSSProperties}>
    <GitHeader loading={model.status.loading || model.diff.loading} onRefresh={model.refresh} onClose={props.onClose} onFiles={props.onFiles} />
    {props.failure || model.status.failure ? <p className="git-error" role="alert">{props.failure ?? model.status.failure}</p> : null}
    {model.status.loading && !report ? <p className="git-hint" role="status">正在读取 Git 状态…</p> : null}
    {!props.project ? <p className="git-empty">先打开一个本地项目</p> : null}
    {report && !report.repository ? <p className="git-empty">当前目录不是 Git 工作树。可切换到文件视图继续浏览。</p> : null}
    {report?.repository ? <>
      <BranchSummary report={report} />
      {props.onOpenProject ? <button className="worktree-entry" type="button" onClick={(event) => { event.currentTarget.focus(); setWorktreesOpen(true); }}>管理独立任务 · Worktree</button> : null}
      {report.truncated ? <p className="git-warning" role="status">改动文件较多，列表未完整加载。</p> : null}
      <div className="git-body">
        <GitFileList groups={model.groups} query={model.query} selected={model.request} onQuery={model.setQuery}
          onSelect={model.select} onOpen={(file) => open(file.path)} />
        <GitDiffView request={model.request} file={model.selected} diff={model.diff.diff}
          loading={model.diff.loading} failure={model.diff.failure}
          onRefresh={model.diff.reload} onOpen={() => { if (model.request) open(model.request.path); }} />
      </div>
    </> : null}
    <PanelResizeHandle label="调整 Git 面板宽度" onCommit={width.commitWidth} onReset={width.resetWidth}
      onResize={width.setWidth} spec={FILE_PREVIEW_WIDTH} width={width.width} />
    {worktreesOpen && report?.repository && props.onOpenProject ? <WorktreeDialog key={report.rootPath} rootPath={report.rootPath}
      onClose={() => { setWorktreesOpen(false); model.refresh(); }} onOpen={props.onOpenProject} /> : null}
  </section>;
}

function GitHeader({ loading, onRefresh, onFiles, onClose }: {
  loading: boolean; onRefresh: () => void; onFiles: () => void; onClose: () => void;
}) {
  return <header className="file-preview__head">
    <GitBranch size={ICON.md} aria-hidden="true" /><h2>Git 变更</h2><span className="git-readonly">只读</span>
    <button className="icon-button icon-button--sm" type="button" title="查看文件" aria-label="查看文件" onClick={onFiles}><FileSearch size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" title="刷新 Git 状态和 Diff" aria-label="刷新 Git 状态和 Diff"
      disabled={loading} onClick={onRefresh}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" title="关闭 Git 面板" aria-label="关闭 Git 面板" onClick={onClose}><X size={ICON.md} aria-hidden="true" /></button>
  </header>;
}

function BranchSummary({ report }: { report: GitStatus }) {
  const branch = report.branch === "(detached)" ? `游离 HEAD · ${report.head?.slice(0, 8) ?? "未知提交"}` : report.branch ?? "未知分支";
  return <div className="git-branch">
    <div><GitBranch size={ICON.sm} aria-hidden="true" /><strong>{branch}</strong>
      {!report.head ? <small>尚无提交</small> : null}
      {report.upstream ? <small title={report.upstream}>↑{report.ahead} ↓{report.behind}</small> : null}
    </div><span title={report.rootPath}>{report.rootPath}</span>
  </div>;
}
