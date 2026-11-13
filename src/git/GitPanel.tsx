import { Notice } from "../components/Notice";
import { t, useTranslation } from "../i18n";
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
  useTranslation();
  const model = useGitPanel(props.project?.rootPath ?? null);
  const width = usePanelWidth(FILE_PREVIEW_WIDTH);
  const [worktreesOpen, setWorktreesOpen] = useState(false);
  const report = model.status.report;
  const open = (path: string) => { if (report) props.onOpenFile({ rootPath: report.rootPath, path }); };
  return <section className="file-preview-panel git-panel" aria-label={t("git.GitPanel.text_dc74d0bd7a")} style={{ "--file-preview-width": `${width.width}px` } as CSSProperties}>
    <GitHeader loading={model.status.loading || model.diff.loading} onRefresh={model.refresh} onClose={props.onClose} onFiles={props.onFiles} />
    {props.failure || model.status.failure ? <Notice className="git-error"
      action={model.status.failure ? <button type="button" disabled={model.status.loading} onClick={model.refresh}>{t("git.GitPanel.text_1133d6759e")}</button> : undefined}>
      {props.failure ?? model.status.failure}</Notice> : null}
    {model.status.loading && !report ? <p className="git-hint" role="status">{t("git.GitPanel.text_26339409bb")}</p> : null}
    {!props.project ? <p className="git-empty">{t("git.GitPanel.text_6768388508")}</p> : null}
    {report && !report.repository ? <p className="git-empty">{t("git.GitPanel.text_6ed91929e1")}</p> : null}
    {report?.repository ? <>
      <BranchSummary report={report} />
      {props.onOpenProject ? <button className="worktree-entry" type="button" onClick={(event) => { event.currentTarget.focus(); setWorktreesOpen(true); }}>{t("git.GitPanel.text_a6e17bd57f")}</button> : null}
      {report.truncated ? <Notice className="git-warning" tone="warning" role="status">{t("git.GitPanel.text_c801235b78")}</Notice> : null}
      <div className="git-body">
        <GitFileList groups={model.groups} query={model.query} selected={model.request} onQuery={model.setQuery}
          onSelect={model.select} onOpen={(file) => open(file.path)} />
        <GitDiffView projectRoot={props.project?.rootPath} request={model.request} file={model.selected} diff={model.diff.diff}
          loading={model.diff.loading} failure={model.diff.failure}
          onRefresh={model.diff.reload} onOpen={() => { if (model.request) open(model.request.path); }} />
      </div>
    </> : null}
    <PanelResizeHandle label={t("git.GitPanel.text_92a0cb3cae")} onCommit={width.commitWidth} onReset={width.resetWidth}
      onResize={width.setWidth} spec={FILE_PREVIEW_WIDTH} width={width.width} />
    {worktreesOpen && report?.repository && props.onOpenProject ? <WorktreeDialog key={report.rootPath} rootPath={report.rootPath}
      onClose={() => { setWorktreesOpen(false); model.refresh(); }} onOpen={props.onOpenProject} /> : null}
  </section>;
}

function GitHeader({ loading, onRefresh, onFiles, onClose }: {
  loading: boolean; onRefresh: () => void; onFiles: () => void; onClose: () => void;
}) {
  useTranslation();
  return <header className="file-preview__head">
    <GitBranch size={ICON.md} aria-hidden="true" /><h2>{t("git.GitPanel.text_dc74d0bd7a")}</h2><span className="git-readonly">{t("git.GitPanel.text_3b5ec3533b")}</span>
    <button className="icon-button icon-button--sm" type="button" title={t("git.GitPanel.text_97873847b7")} aria-label={t("git.GitPanel.text_97873847b7")} onClick={onFiles}><FileSearch size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" title={t("git.GitPanel.text_ac9ba31284")} aria-label={t("git.GitPanel.text_ac9ba31284")}
      disabled={loading} onClick={onRefresh}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" title={t("git.GitPanel.text_d431f859dd")} aria-label={t("git.GitPanel.text_d431f859dd")} onClick={onClose}><X size={ICON.md} aria-hidden="true" /></button>
  </header>;
}

function BranchSummary({ report }: { report: GitStatus }) {
  useTranslation();
  const branch = report.branch === "(detached)" ? t("git.GitPanel.text_572519d3bd", { commit: report.head?.slice(0, 8) ?? t("git.GitPanel.text_9d4c6ae8a4") }) : report.branch ?? t("git.GitPanel.text_a6bc62f01b");
  return <div className="git-branch">
    <div><GitBranch size={ICON.sm} aria-hidden="true" /><strong>{branch}</strong>
      {!report.head ? <small>{t("git.GitPanel.text_233a788301")}</small> : null}
      {report.upstream ? <small title={report.upstream}>↑{report.ahead} ↓{report.behind}</small> : null}
    </div><span title={report.rootPath}>{report.rootPath}</span><small>{t("git.GitPanel.text_3b2d053db3")}</small>
  </div>;
}
