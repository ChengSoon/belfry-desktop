import { Notice } from "../components/Notice";
import { formatNumber, t, useTranslation } from "../i18n";
import {
  ArrowLeft,
  ChevronRight,
  FileCode2,
  FileSearch,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelResizeHandle } from "../panel/PanelResizeHandle";
import { usePanelWidth } from "../panel/usePanelWidth";
import { ICON } from "../theme/sizing";
import type { ProjectWorkspace } from "../workspace/contracts";
import { HighlightedCode } from "./highlight";
import type { ProjectEntry } from "./contracts";
import { FILE_PREVIEW_WIDTH } from "./filePreviewWidth";
import { filterEntries, parentPath } from "./path";
import { useFilePreview } from "./useFilePreview";
import "./filePreview.css";

interface FilePreviewPaneProps {
  project: ProjectWorkspace | null;
  onClose: () => void;
  requestedLine?: number | null;
  requestedPath?: string | null;
  onGit?: () => void;
}

export function FilePreviewPane({
  project,
  onClose,
  requestedLine = null,
  requestedPath = null,
  onGit,
}: FilePreviewPaneProps) {
  useTranslation();
  const preview = useFilePreview(project);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(FILE_PREVIEW_WIDTH);
  const [query, setQuery] = useState("");
  const requestKey = JSON.stringify([project?.rootPath ?? "", requestedPath ?? "", requestedLine]);
  const handledRequest = useRef("");
  const panelStyle = { "--file-preview-width": `${width}px` } as CSSProperties;
  const entries = preview.directory ? filterEntries(preview.directory.entries, query) : [];

  useEffect(() => {
    if (!requestedPath || requestKey === handledRequest.current) return;
    handledRequest.current = requestKey;
    setQuery("");
    preview.openPath(requestedPath);
  }, [preview.openPath, requestKey, requestedPath]);

  return (
    <section className="file-preview-panel" aria-label={t("filepreview.FilePreviewPane.text_f3c5fe4dd2")} style={panelStyle}>
      <header className="file-preview__head">
        <FileSearch aria-hidden="true" size={ICON.md} />
        <h2>{t("filepreview.FilePreviewPane.text_f3c5fe4dd2")}</h2>
        <span className="file-preview__readonly">{t("filepreview.FilePreviewPane.text_3b5ec3533b")}</span>
        {onGit ? <button className="icon-button icon-button--sm" onClick={onGit} title={t("filepreview.FilePreviewPane.text_9f0f7ccc57")} aria-label={t("filepreview.FilePreviewPane.text_9f0f7ccc57")} type="button">
          <GitBranch aria-hidden="true" size={ICON.sm} />
        </button> : null}
        <button className="icon-button icon-button--sm" disabled={!project || preview.loadingDirectory} onClick={preview.refresh} title={t("filepreview.FilePreviewPane.text_bac6fbe5d6")} type="button">
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title={t("filepreview.FilePreviewPane.text_cd32a1a3fb")} type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {!project ? <EmptyProject /> : (
        <>
          <div className="file-preview__location">
            <button
              aria-label={t("filepreview.FilePreviewPane.text_f935559561")}
              className="icon-button icon-button--sm"
              disabled={!preview.directoryPath}
              onClick={() => preview.openDirectory(parentPath(preview.directoryPath))}
              title={t("filepreview.FilePreviewPane.text_f935559561")}
              type="button"
            >
              <ArrowLeft aria-hidden="true" size={ICON.sm} />
            </button>
            <div className="file-preview__breadcrumbs">
              <button className={!preview.directoryPath ? "is-current" : undefined} onClick={() => preview.openDirectory("")} type="button">{project.name}</button>
              {preview.directoryPath.split("/").filter(Boolean).map((segment, index, parts) => {
                const path = parts.slice(0, index + 1).join("/");
                return <span key={path}><ChevronRight aria-hidden="true" size={ICON.xs} /><button className={index === parts.length - 1 ? "is-current" : undefined} onClick={() => preview.openDirectory(path)} type="button">{segment}</button></span>;
              })}
            </div>
          </div>

          <div className="file-preview__body">
            <aside className="file-preview__tree" aria-label={t("filepreview.FilePreviewPane.text_07e577ff8c")}>
              <label className="file-preview__filter">
                <Search aria-hidden="true" size={ICON.xs} />
                <input aria-label={t("filepreview.FilePreviewPane.text_43d3df4fe7")} onChange={(event) => setQuery(event.target.value)} placeholder={t("filepreview.FilePreviewPane.text_43d3df4fe7")} value={query} />
              </label>
              {preview.loadingDirectory ? <p className="file-preview__hint">{t("filepreview.FilePreviewPane.text_86b6d0d630")}</p> : null}
              {!preview.loadingDirectory && entries.length === 0 ? <p className="file-preview__hint" role="status">{query ? t("filepreview.FilePreviewPane.text_c315d9c025") : t("filepreview.FilePreviewPane.text_77fa57e995")}</p> : null}
              <ul className="file-preview__entries">
                {entries.map((entry) => <EntryRow entry={entry} key={entry.relativePath} onOpenDirectory={preview.openDirectory} onOpenFile={preview.openFile} selected={preview.selectedPath === entry.relativePath} />)}
              </ul>
              {preview.directory?.truncated ? <p className="file-preview__hint">{t("filepreview.FilePreviewPane.text_92c23c3116", { count: preview.directory.entries.length })}</p> : null}
            </aside>
            <PreviewContent
              focusLine={preview.preview?.relativePath === requestedPath ? requestedLine : null}
              loading={preview.loadingFile}
              onReload={preview.reloadFile}
              preview={preview.preview}
              stale={preview.stale}
            />
          </div>
          {preview.failure ? <Notice className="file-preview__error" action={<>
            <button className="file-preview__retry" disabled={preview.loadingDirectory} onClick={preview.refresh} type="button">{t("filepreview.FilePreviewPane.text_ae93d47bc5")}</button>
            <button className="file-preview__dismiss" onClick={preview.clearFailure} aria-label={t("filepreview.FilePreviewPane.text_9ce0447cb3")} title={t("filepreview.FilePreviewPane.text_9ce0447cb3")} type="button"><X aria-hidden="true" size={ICON.xs} /></button>
          </>}>{preview.failure}</Notice> : null}
        </>
      )}

      <PanelResizeHandle label={t("filepreview.FilePreviewPane.text_31500023a0")} onCommit={commitWidth} onReset={resetWidth} onResize={setWidth} spec={FILE_PREVIEW_WIDTH} width={width} />
    </section>
  );
}

interface EntryRowProps {
  entry: ProjectEntry;
  onOpenDirectory: (path: string) => void;
  onOpenFile: (path: string) => void;
  selected: boolean;
}

function EntryRow({ entry, onOpenDirectory, onOpenFile, selected }: EntryRowProps) {
  useTranslation();
  const directory = entry.kind === "directory";
  return (
    <li>
      <button
        className={`file-preview__entry${selected ? " is-selected" : ""}`}
        onClick={() => directory ? onOpenDirectory(entry.relativePath) : onOpenFile(entry.relativePath)}
        title={entry.relativePath}
        type="button"
      >
        <span className="file-preview__entry-icon">
          {directory
            ? (selected ? <FolderOpen size={ICON.sm} /> : <Folder size={ICON.sm} />)
            : <FileCode2 size={ICON.sm} />}
        </span>
        <span>{entry.name}</span>
        {directory ? <ChevronRight className="file-preview__entry-chevron" size={ICON.xs} /> : null}
      </button>
    </li>
  );
}

interface PreviewContentProps {
  focusLine: number | null;
  preview: ReturnType<typeof useFilePreview>["preview"];
  loading: boolean;
  stale: boolean;
  onReload: () => void;
}

function PreviewContent({ focusLine, preview, loading, stale, onReload }: PreviewContentProps) {
  useTranslation();
  if (loading) {
    return <main className="file-preview__content"><p className="file-preview__empty">{t("filepreview.FilePreviewPane.text_06f4872bfc")}</p></main>;
  }
  if (!preview) {
    return <main className="file-preview__content"><div className="file-preview__empty"><FileSearch aria-hidden="true" size={28} /><p>{t("filepreview.FilePreviewPane.text_b24f62e436")}</p></div></main>;
  }
  if (preview.binary) {
    return <main className="file-preview__content"><div className="file-preview__empty"><FileCode2 aria-hidden="true" size={28} /><p>{t("filepreview.FilePreviewPane.text_1fa59b7ee1")}</p><small>{formatBytes(preview.size)}</small></div></main>;
  }
  return (
    <main className="file-preview__content">
      <header className="file-preview__file-head">
        <div><strong>{preview.name}</strong><span>{preview.relativePath}</span></div>
        <span className="file-preview__language">{preview.language ?? "text"}</span>
      </header>
      {stale ? (
        <Notice className="file-preview__stale" tone="warning" action={<button onClick={onReload} type="button">{t("filepreview.FilePreviewPane.text_7bdd5ce1e2")}</button>}>
          {t("filepreview.FilePreviewPane.text_d60322e8aa")}
        </Notice>
      ) : null}
      <div className="file-preview__scroll">
        <HighlightedCode content={preview.content} focusLine={focusLine} language={preview.language} />
      </div>
      {preview.truncated ? (
        <footer className="file-preview__foot">{t("filepreview.FilePreviewPane.text_d2d3ea666e", { shownSize: formatBytes(512 * 1024), totalSize: formatBytes(preview.size) })}</footer>
      ) : null}
    </main>
  );
}

function EmptyProject() {
  useTranslation();
  return <div className="file-preview__empty"><FileSearch aria-hidden="true" size={28} /><p>{t("filepreview.FilePreviewPane.text_2d76695cdc")}</p></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${formatNumber(value)} B`;
  if (value < 1024 * 1024) return `${formatNumber(Math.round(value / 1024))} KB`;
  return `${formatNumber(value / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}
