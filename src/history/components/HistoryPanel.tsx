import { AlertTriangle, Check, History, ListChecks, Play, RefreshCcw, Trash2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import { failureLabel } from "../../workspace/errors";
import type { HistorySession } from "../contracts";
import { HISTORY_WIDTH } from "../historyWidth";
import { sessionKey } from "../metadata";
import { useHistoryPanel } from "../useHistoryPanel";
import { HistoryRow } from "./HistoryRow";
import { HistorySearchControls } from "./HistorySearchControls";
import { HistoryDetailPanel } from "../details/HistoryDetailPanel";
import "../history.css";
import "../historySearch.css";

interface Props { onClose: () => void; onResume: (session: HistorySession) => void }
type Model = ReturnType<typeof useHistoryPanel>;

export function HistoryPanel({ onClose, onResume }: Props) {
  const model = useHistoryPanel();
  const width = usePanelWidth(HISTORY_WIDTH);
  const [detail, setDetail] = useState<HistorySession | null>(null);
  if (detail) return <HistoryDetailPanel session={detail} query={model.filters.text} width={width}
    onBack={() => setDetail(null)} onClose={onClose} onResume={onResume} />;
  const style = { "--history-width": `${width.width}px` } as CSSProperties;
  return <section className="history-panel" aria-label="历史会话" style={style}>
    <HistoryHeader model={model} onClose={onClose} />
    <HistorySearchControls filters={model.filters} projects={model.history.report.projects}
      tags={model.metadata.tags} onChange={model.change} />
    <div className="history-toolstrip">
      <HistoryStatus model={model} />
      {model.selection.selecting ? <SelectionToolbar model={model} onResume={onResume} /> : null}
    </div>
    <HistoryResults model={model} onResume={onResume} onInspect={setDetail} />
    <PanelResizeHandle label="调整历史会话面板宽度" onCommit={width.commitWidth} onReset={width.resetWidth}
      onResize={width.setWidth} spec={HISTORY_WIDTH} width={width.width} />
    {model.pendingDelete ? <ConfirmDialog title={`删除这 ${model.pendingDelete.length} 条历史会话？`}
      body="将永久删除所列会话的原始日志及其续写分片，无法恢复。只处理此次选中的结果，正在运行的会话进程不受影响。"
      confirmLabel="删除会话日志" onCancel={() => model.setPendingDelete(null)} onConfirm={model.confirmDelete} /> : null}
  </section>;
}

function HistoryHeader({ model, onClose }: { model: Model; onClose: () => void }) {
  const disabled = model.history.loading || model.history.busy.size > 0;
  return <header className="history-head">
    <History aria-hidden="true" size={ICON.md} /><h2>历史会话</h2>
    <span className="history-count">{model.hits.length}</span>
    <button className="icon-button icon-button--sm" disabled={disabled} type="button" title="重新扫描会话日志"
      onClick={() => void model.history.reload()}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" aria-pressed={model.selection.selecting}
      disabled={disabled || (!model.selection.selecting && !model.hits.length)}
      title={model.selection.selecting ? "完成选择" : "多选会话"} onClick={model.selection.toggleMode}>
      {model.selection.selecting ? <Check size={ICON.sm} aria-hidden="true" /> : <ListChecks size={ICON.sm} aria-hidden="true" />}
    </button>
    <button className="icon-button icon-button--sm history-item__delete" type="button" title="删除全部当前结果"
      disabled={disabled || !model.hits.length} onClick={() => model.setPendingDelete(model.hits.map((hit) => hit.session))}>
      <Trash2 size={ICON.sm} aria-hidden="true" />
    </button>
    <button className="icon-button icon-button--sm" onClick={onClose} type="button" title="关闭历史会话">
      <X size={ICON.md} aria-hidden="true" />
    </button>
  </header>;
}

function HistoryStatus({ model }: { model: Model }) {
  const { history, metadata, query } = model;
  const errors = [query.error, metadata.error, history.failure ? failureLabel(history.failure) : null].filter(Boolean);
  return <>
    {errors.map((error) => <p key={error} className="history-error" role="alert"><AlertTriangle size={ICON.sm} aria-hidden="true" />{error}</p>)}
    <div className="history-search-summary" aria-live="polite">
      <span>{history.loading ? "正在读取本地历史…" : `${model.hits.length} 条会话 · ${history.report.scannedFiles} 个日志`}</span>
      <button type="button" onClick={model.reset}>清除筛选</button>
    </div>
    {history.report.skippedFiles || history.report.skippedLines ? <p className="history-search-warning" role="status">
      有 {history.report.skippedFiles} 个文件、{history.report.skippedLines} 行无法读取或超过大小限制，结果可能不完整。
    </p> : null}
  </>;
}

function SelectionToolbar({ model, onResume }: { model: Model; onResume: Props["onResume"] }) {
  const targets = model.selection.selectedSessions;
  return <div className="history-toolbar">
    <span className="history-toolbar__count">已选 {targets.length} / {model.hits.length}</span>
    <button className="history-toolbar__action" type="button" onClick={model.selection.toggleAll}>
      {targets.length === model.hits.length ? "取消全选" : "全选结果"}
    </button><span className="history-toolbar__spacer" />
    <button className="history-toolbar__action" type="button" disabled={!targets.length}
      title="继续选中的会话" onClick={() => targets.forEach(onResume)}><Play size={ICON.xs} aria-hidden="true" />继续</button>
    <button className="history-toolbar__action history-toolbar__action--danger" type="button"
      disabled={!targets.length || model.history.busy.size > 0} onClick={() => model.setPendingDelete(targets)}>删除</button>
  </div>;
}

function HistoryResults({ model, onResume, onInspect }: { model: Model; onResume: Props["onResume"]; onInspect: Props["onResume"] }) {
  return <div className="history-body">
    {!model.history.loading && !model.hits.length && !model.history.failure && !model.query.error
      ? <div className="history-empty"><p>没有符合条件的会话</p><button type="button" onClick={model.reset}>清除筛选，查看全部历史</button></div> : null}
    <ul className="history-list">{model.visible.map((hit) => {
      const key = sessionKey(hit.session.sessionRef);
      return <HistoryRow key={key} hit={hit} query={model.filters.text}
        metadata={model.metadata.entries[key] ?? { favorite: false, tags: [] }}
        selected={model.selection.selected.has(key)} selecting={model.selection.selecting} busy={model.history.busy.size > 0}
        onResume={onResume} onInspect={onInspect} onDelete={(session) => model.setPendingDelete([session])} onSelect={model.selection.toggle}
        onFavorite={model.favorite} onTags={(session, tags) => model.metadata.save(session.sessionRef, { tags })}
        onTagFilter={(tag) => model.change({ tag })} />;
    })}</ul>
    {model.visible.length < model.hits.length ? <button className="history-more" type="button" onClick={model.showMore}>
      显示更多（{model.visible.length} / {model.hits.length}）
    </button> : null}
  </div>;
}
