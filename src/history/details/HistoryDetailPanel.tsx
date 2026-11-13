import { Notice } from "../../components/Notice";
import { t, useTranslation } from "../../i18n";
import { ArrowLeft, Play, RefreshCcw, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { ICON } from "../../theme/sizing";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import type { usePanelWidth } from "../../panel/usePanelWidth";
import { agentLabel } from "../../usage/format";
import type { HistorySession } from "../contracts";
import { HISTORY_WIDTH } from "../historyWidth";
import { useHistoryDetail } from "./useHistoryDetail";
import { HistoryMessages } from "./HistoryMessages";
import { HistoryChanges } from "./HistoryChanges";
import { byteLabel, pageChanges } from "./model";
import { focusMessageInPanel } from "./messageFocus";
import "./historyDetails.css";

interface Props {
  session: HistorySession; query: string; width: ReturnType<typeof usePanelWidth>;
  onBack: () => void; onClose: () => void; onResume: (session: HistorySession) => void;
}

export function HistoryDetailPanel(props: Props) {
  useTranslation();
  const state = useHistoryDetail(props.session.sessionRef);
  const [view, setView] = useState<"messages" | "changes">("messages");
  const [selected, setSelected] = useState<string | null>(null);
  const changes = pageChanges(state.page?.entries ?? []);
  const jump = (id: string) => {
    setView("messages"); setSelected(id);
    requestAnimationFrame(() => {
      const entry = document.getElementById(`history-message-${id}`);
      if (entry) focusMessageInPanel(entry);
    });
  };
  return <section className="history-panel history-panel--details" aria-label={t("history.HistoryDetailPanel.text_670ab45ad3")}
    style={{ "--history-width": `${props.width.width}px` } as CSSProperties}>
    <DetailHeader props={props} busy={state.busy} onReload={state.reload} />
    <div className="history-detail__intro"><strong>{props.session.title || t("history.HistoryDetailPanel.text_8af5d7ce46")}</strong>
      <p title={props.session.cwd ?? undefined}>{agentLabel(props.session.agent)} · {props.session.cwd ?? t("history.HistoryDetailPanel.text_bea918d0ca")}</p>
      <nav aria-label={t("history.HistoryDetailPanel.text_26b5755481")}><button type="button" aria-pressed={view === "messages"} onClick={() => setView("messages")}>{t("history.HistoryDetailPanel.text_d1aba108b8")}</button>
        <button type="button" aria-pressed={view === "changes"} onClick={() => setView("changes")}>{t("history.HistoryDetailPanel.text_62ceb2fcb5", { count: changes.length })}</button></nav></div>
    <div className="history-detail__body" aria-busy={state.busy}>
      <DetailReadStatus state={state} />
      {state.page ? view === "messages" ? <HistoryMessages entries={state.page.entries} selectedId={selected} query={props.query} />
        : <HistoryChanges records={changes} onJump={jump} /> : null}
    </div>
    <DetailFooter state={state} />
    <PanelResizeHandle label={t("history.HistoryDetailPanel.text_dd165cdf68")} onCommit={props.width.commitWidth} onReset={props.width.resetWidth}
      onResize={props.width.setWidth} spec={HISTORY_WIDTH} width={props.width.width} />
  </section>;
}

function DetailReadStatus({ state }: { state: ReturnType<typeof useHistoryDetail> }) {
  useTranslation();
  return <>
    {state.error ? <Notice className="history-detail__warning" action={<button type="button" disabled={state.busy} onClick={state.reload}>{t("history.HistoryPanel.text_13be69053d")}</button>}>{state.error}</Notice> : null}
    {state.busy ? <p className="history-detail__note" role="status">{t("history.HistoryDetailPanel.text_e7985fed10")}</p> : null}
    {state.page?.note ? <Notice className="history-detail__warning" tone="warning" role="status">{state.page.note}</Notice> : null}
    {state.page?.skippedLines ? <Notice className="history-detail__warning" tone="warning" role="status">{t("history.HistoryDetailPanel.text_bf39ff5bdb", { count: state.page.skippedLines })}</Notice> : null}
  </>;
}

function DetailHeader({ props, busy, onReload }: { props: Props; busy: boolean; onReload: () => void }) {
  useTranslation();
  return <header className="history-head">
    <button className="icon-button icon-button--sm" title={t("history.HistoryDetailPanel.text_8c1a516dbe")} type="button" onClick={props.onBack}><ArrowLeft size={ICON.sm} /></button><h2>{t("history.HistoryDetailPanel.text_1448e376cb")}</h2>
    <button className="icon-button icon-button--sm" title={t("history.HistoryDetailPanel.text_9f935bb5e4")} type="button" disabled={busy} onClick={onReload}><RefreshCcw size={ICON.sm} /></button>
    <button className="icon-button icon-button--sm" title={t("history.HistoryDetailPanel.text_85417aac9c")} type="button" onClick={() => props.onResume(props.session)}><Play size={ICON.sm} /></button>
    <button className="icon-button icon-button--sm" title={t("history.HistoryDetailPanel.text_0587f7ff16")} type="button" onClick={props.onClose}><X size={ICON.sm} /></button>
  </header>;
}

function DetailFooter({ state }: { state: ReturnType<typeof useHistoryDetail> }) {
  useTranslation();
  return <footer className="history-detail__footer">
    <div><button type="button" disabled={state.busy || !state.hasPrevious} onClick={state.previous}>{t("history.HistoryDetailPanel.text_c9b9ae7a61")}</button>
      <span>{t("history.HistoryDetailPanel.text_43d64eccc0", { page: (state.page?.page ?? 0) + 1 })}</span>
      <button type="button" disabled={state.busy || !state.page?.hasMore} onClick={state.next}>{t("history.HistoryDetailPanel.text_8a8542f696")}</button></div>
    {state.page ? <small>{t("history.HistoryDetailPanel.text_8efbb64d21", { readSize: byteLabel(state.page.scannedBytes), totalSize: byteLabel(state.page.totalBytes) })}</small> : null}
    {state.earlierEvicted ? <button type="button" disabled={state.busy} onClick={state.reload}>{t("history.HistoryDetailPanel.text_6f3f6944e9")}</button> : null}
  </footer>;
}
