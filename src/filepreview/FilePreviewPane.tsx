import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  FileCode2,
  FileSearch,
  Folder,
  FolderOpen,
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
}

export function FilePreviewPane({
  project,
  onClose,
  requestedLine = null,
  requestedPath = null,
}: FilePreviewPaneProps) {
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
    <section className="file-preview-panel" aria-label="文件预览" style={panelStyle}>
      <header className="file-preview__head">
        <FileSearch aria-hidden="true" size={ICON.md} />
        <h2>文件预览</h2>
        <button className="icon-button icon-button--sm" disabled={!project || preview.loadingDirectory} onClick={preview.refresh} title="刷新文件" type="button">
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title="关闭文件预览" type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {!project ? <EmptyProject /> : (
        <>
          <div className="file-preview__location">
            <button
              aria-label="返回上级目录"
              className="icon-button icon-button--sm"
              disabled={!preview.directoryPath}
              onClick={() => preview.openDirectory(parentPath(preview.directoryPath))}
              title="返回上级目录"
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
            <aside className="file-preview__tree" aria-label="项目文件">
              <label className="file-preview__filter">
                <Search aria-hidden="true" size={ICON.xs} />
                <input aria-label="筛选当前目录" onChange={(event) => setQuery(event.target.value)} placeholder="筛选当前目录" value={query} />
              </label>
              {preview.loadingDirectory ? <p className="file-preview__hint">正在读取…</p> : null}
              {!preview.loadingDirectory && entries.length === 0 ? <p className="file-preview__hint">目录为空</p> : null}
              <ul className="file-preview__entries">
                {entries.map((entry) => <EntryRow entry={entry} key={entry.relativePath} onOpenDirectory={preview.openDirectory} onOpenFile={preview.openFile} selected={preview.selectedPath === entry.relativePath} />)}
              </ul>
              {preview.directory?.truncated ? <p className="file-preview__hint">条目过多，仅显示前 {preview.directory.entries.length} 项</p> : null}
            </aside>
            <PreviewContent
              focusLine={preview.preview?.relativePath === requestedPath ? requestedLine : null}
              loading={preview.loadingFile}
              onReload={preview.reloadFile}
              preview={preview.preview}
              stale={preview.stale}
            />
          </div>
          {preview.failure ? <div className="file-preview__error" role="alert"><AlertTriangle aria-hidden="true" size={ICON.sm} /><span>{preview.failure}</span><button onClick={preview.clearFailure} title="关闭错误" type="button"><X aria-hidden="true" size={ICON.xs} /></button></div> : null}
        </>
      )}

      <PanelResizeHandle label="调整文件预览宽度" onCommit={commitWidth} onReset={resetWidth} onResize={setWidth} spec={FILE_PREVIEW_WIDTH} width={width} />
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
  if (loading) {
    return <main className="file-preview__content"><p className="file-preview__empty">正在打开文件…</p></main>;
  }
  if (!preview) {
    return <main className="file-preview__content"><div className="file-preview__empty"><FileSearch aria-hidden="true" size={28} /><p>选择一个文件开始预览</p></div></main>;
  }
  if (preview.binary) {
    return <main className="file-preview__content"><div className="file-preview__empty"><FileCode2 aria-hidden="true" size={28} /><p>这是二进制文件，无法预览</p><small>{formatBytes(preview.size)}</small></div></main>;
  }
  return (
    <main className="file-preview__content">
      <header className="file-preview__file-head">
        <div><strong>{preview.name}</strong><span>{preview.relativePath}</span></div>
        <span className="file-preview__language">{preview.language ?? "text"}</span>
      </header>
      {stale ? (
        <div className="file-preview__stale" role="status">
          <span>文件已在磁盘上发生变化</span>
          <button onClick={onReload} type="button">重新加载</button>
        </div>
      ) : null}
      <div className="file-preview__scroll">
        <HighlightedCode content={preview.content} focusLine={focusLine} language={preview.language} />
      </div>
      {preview.truncated ? (
        <footer className="file-preview__foot">
          文件较大，仅显示前 {formatBytes(512 * 1024)} · 总大小 {formatBytes(preview.size)}
        </footer>
      ) : null}
    </main>
  );
}

function EmptyProject() {
  return <div className="file-preview__empty"><FileSearch aria-hidden="true" size={28} /><p>先打开一个项目</p></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
