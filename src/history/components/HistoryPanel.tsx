import { formatNumber } from "../../i18n";
import { t, useTranslation } from "../../i18n";
import { Check, History, ListChecks, Play, RefreshCcw, Trash2, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Notice } from "../../components/Notice";
import { Presence } from "../../components/motion/Presence";
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
  useTranslation();
  const model = useHistoryPanel();
  const width = usePanelWidth(HISTORY_WIDTH);
  const [detail, setDetail] = useState<HistorySession | null>(null);
  if (detail) return <HistoryDetailPanel session={detail} query={model.filters.text} width={width}
    onBack={() => setDetail(null)} onClose={onClose} onResume={onResume} />;
  const style = { "--history-width": `${width.width}px` } as CSSProperties;
  return <section className="history-panel" aria-label={t("history.HistoryPanel.text_0eccd0db7b")} style={style}>
    <HistoryHeader model={model} onClose={onClose} />
    <HistorySearchControls filters={model.filters} projects={model.history.report.projects}
      tags={model.metadata.tags} onChange={model.change} />
    <div className="history-toolstrip">
      <HistoryStatus model={model} />
      {model.selection.selecting ? <SelectionToolbar model={model} onResume={onResume} /> : null}
    </div>
    <HistoryResults model={model} onResume={onResume} onInspect={setDetail} />
    <PanelResizeHandle label={t("history.HistoryPanel.text_61bf99f0cb")} onCommit={width.commitWidth} onReset={width.resetWidth}
      onResize={width.setWidth} spec={HISTORY_WIDTH} width={width.width} />
    <Presence open={!!model.pendingDelete}>
    {model.pendingDelete ? <ConfirmDialog title={t("history.HistoryPanel.text_3ea472e85d", { count: model.pendingDelete.length })}
      body={t("history.HistoryPanel.text_04f70ac233")}
      confirmLabel={t("history.HistoryPanel.text_e44e2b0a7c")} onCancel={() => model.setPendingDelete(null)} onConfirm={model.confirmDelete} /> : null}
    </Presence>
  </section>;
}

function HistoryHeader({ model, onClose }: { model: Model; onClose: () => void }) {
  useTranslation();
  const disabled = model.history.loading || model.history.busy.size > 0;
  return <header className="history-head">
    <History aria-hidden="true" size={ICON.md} /><h2>{t("history.HistoryPanel.text_0eccd0db7b")}</h2>
    <span className="history-count">{formatNumber(model.hits.length)}</span>
    <button className="icon-button icon-button--sm" disabled={disabled} type="button" title={t("history.HistoryPanel.text_b5b73ad712")}
      onClick={() => void model.history.reload()}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
    <button className="icon-button icon-button--sm" type="button" aria-pressed={model.selection.selecting}
      disabled={disabled || (!model.selection.selecting && !model.hits.length)}
      title={model.selection.selecting ? t("history.HistoryPanel.text_ce30b3292f") : t("history.HistoryPanel.text_351b83dea4")} onClick={model.selection.toggleMode}>
      {model.selection.selecting ? <Check size={ICON.sm} aria-hidden="true" /> : <ListChecks size={ICON.sm} aria-hidden="true" />}
    </button>
    <button className="icon-button icon-button--sm history-item__delete" type="button" title={t("history.HistoryPanel.text_34c118ed28")}
      disabled={disabled || !model.hits.length} onClick={() => model.setPendingDelete(model.hits.map((hit) => hit.session))}>
      <Trash2 size={ICON.sm} aria-hidden="true" />
    </button>
    <button className="icon-button icon-button--sm" onClick={onClose} type="button" title={t("history.HistoryPanel.text_7ed20840eb")}>
      <X size={ICON.md} aria-hidden="true" />
    </button>
  </header>;
}

function HistoryStatus({ model }: { model: Model }) {
  useTranslation();
  const { history, metadata, query } = model;
  const errors = [
    { source: "query", message: query.error },
    { source: "metadata", message: metadata.error },
    { source: "history", message: history.failure ? failureLabel(history.failure) : null },
  ].filter((error) => error.message);
  return <>
    {errors.map((error) => <Notice key={error.source} className="history-error"
      action={error.source === "history" ? <button className="history-retry" type="button" disabled={history.loading}
        onClick={() => void history.reload()}>{t("history.HistoryPanel.text_13be69053d")}</button> : undefined}>
      {error.message}</Notice>)}
    <div className="history-search-summary" aria-live="polite">
      <span>{history.loading ? t("history.HistoryPanel.text_6ab16c7181") : t("history.HistoryPanel.text_edfea22045", { count: model.hits.length, scannedFiles: history.report.scannedFiles })}</span>
      <button type="button" onClick={model.reset}>{t("history.HistoryPanel.text_657d9cbf45")}</button>
    </div>
    {history.report.skippedFiles || history.report.skippedLines ? <Notice className="history-search-warning" tone="warning">{t("history.HistoryPanel.text_ee729619b1", { skippedFiles: history.report.skippedFiles, skippedLines: history.report.skippedLines })}</Notice> : null}
  </>;
}

function SelectionToolbar({ model, onResume }: { model: Model; onResume: Props["onResume"] }) {
  useTranslation();
  const targets = model.selection.selectedSessions;
  return <div className="history-toolbar">
    <span className="history-toolbar__count">{t("history.HistoryPanel.text_d96fb6c8b1", { count: targets.length, total: model.hits.length })}</span>
    <button className="history-toolbar__action" type="button" onClick={model.selection.toggleAll}>
      {targets.length === model.hits.length ? t("history.HistoryPanel.text_f4d4bae588") : t("history.HistoryPanel.text_d9b7280fd8")}
    </button><span className="history-toolbar__spacer" />
    <button className="history-toolbar__action" type="button" disabled={!targets.length}
      title={t("history.HistoryPanel.text_03e0d29ee8")} onClick={() => targets.forEach(onResume)}><Play size={ICON.xs} aria-hidden="true" />{t("history.HistoryPanel.text_7c9691192f")}</button>
    <button className="history-toolbar__action history-toolbar__action--danger" type="button"
      disabled={!targets.length || model.history.busy.size > 0} onClick={() => model.setPendingDelete(targets)}>{t("history.HistoryPanel.text_2f9daa8289")}</button>
  </div>;
}

function HistoryResults({ model, onResume, onInspect }: { model: Model; onResume: Props["onResume"]; onInspect: Props["onResume"] }) {
  useTranslation();
  return <div className="history-body" aria-busy={model.history.loading}>
    {!model.history.loading && !model.hits.length && !model.history.failure && !model.query.error
      ? <div className="history-empty"><p>{t("history.HistoryPanel.text_f4fccb8cac")}</p><button type="button" onClick={model.reset}>{t("history.HistoryPanel.text_5653a2f869")}</button></div> : null}
    <ul className="history-list">{model.visible.map((hit) => {
      const key = sessionKey(hit.session.sessionRef);
      return <HistoryRow key={key} hit={hit} query={model.filters.text}
        metadata={model.metadata.entries[key] ?? { favorite: false, tags: [] }}
        selected={model.selection.selected.has(key)} selecting={model.selection.selecting} busy={model.history.busy.size > 0}
        onResume={onResume} onInspect={onInspect} onDelete={(session) => model.setPendingDelete([session])} onSelect={model.selection.toggle}
        onFavorite={model.favorite} onTags={(session, tags) => model.metadata.save(session.sessionRef, { tags })}
        onTagFilter={(tag) => model.change({ tag })} />;
    })}</ul>
    {model.visible.length < model.hits.length ? <button className="history-more" type="button" onClick={model.showMore}>{t("history.HistoryPanel.text_3788b35754", { count: model.visible.length, total: model.hits.length })}</button> : null}
  </div>;
}
