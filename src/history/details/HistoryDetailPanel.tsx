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
  return <section className="history-panel history-panel--details" aria-label="历史会话详情"
    style={{ "--history-width": `${props.width.width}px` } as CSSProperties}>
    <DetailHeader props={props} busy={state.busy} onReload={state.reload} />
    <div className="history-detail__intro"><strong>{props.session.title || "无标题会话"}</strong>
      <p title={props.session.cwd ?? undefined}>{agentLabel(props.session.agent)} · {props.session.cwd ?? "目录未记录"}</p>
      <nav aria-label="详情视图"><button type="button" aria-pressed={view === "messages"} onClick={() => setView("messages")}>本页消息</button>
        <button type="button" aria-pressed={view === "changes"} onClick={() => setView("changes")}>代码变更 · {changes.length}</button></nav></div>
    <div className="history-detail__body" aria-busy={state.busy}>
      <DetailReadStatus state={state} />
      {state.page ? view === "messages" ? <HistoryMessages entries={state.page.entries} selectedId={selected} query={props.query} />
        : <HistoryChanges records={changes} onJump={jump} /> : null}
    </div>
    <DetailFooter state={state} />
    <PanelResizeHandle label="调整历史详情面板宽度" onCommit={props.width.commitWidth} onReset={props.width.resetWidth}
      onResize={props.width.setWidth} spec={HISTORY_WIDTH} width={props.width.width} />
  </section>;
}

function DetailReadStatus({ state }: { state: ReturnType<typeof useHistoryDetail> }) {
  return <>
    {state.error ? <p className="history-detail__warning" role="alert">{state.error}</p> : null}
    {state.busy ? <p className="history-detail__note" role="status">正在读取历史记录…</p> : null}
    {state.page?.note ? <p className="history-detail__warning" role="status">{state.page.note}</p> : null}
    {state.page?.skippedLines ? <p className="history-detail__warning" role="status">已跳过 {state.page.skippedLines} 条损坏或过大的记录，内容可能不完整。</p> : null}
  </>;
}

function DetailHeader({ props, busy, onReload }: { props: Props; busy: boolean; onReload: () => void }) {
  return <header className="history-head">
    <button className="icon-button icon-button--sm" title="返回历史列表" type="button" onClick={props.onBack}><ArrowLeft size={ICON.sm} /></button><h2>会话详情</h2>
    <button className="icon-button icon-button--sm" title="从头刷新详情" type="button" disabled={busy} onClick={onReload}><RefreshCcw size={ICON.sm} /></button>
    <button className="icon-button icon-button--sm" title="继续此会话" type="button" onClick={() => props.onResume(props.session)}><Play size={ICON.sm} /></button>
    <button className="icon-button icon-button--sm" title="关闭历史详情" type="button" onClick={props.onClose}><X size={ICON.sm} /></button>
  </header>;
}

function DetailFooter({ state }: { state: ReturnType<typeof useHistoryDetail> }) {
  return <footer className="history-detail__footer">
    <div><button type="button" disabled={state.busy || !state.hasPrevious} onClick={state.previous}>上一页</button>
      <span>第 {(state.page?.page ?? 0) + 1} 页</span>
      <button type="button" disabled={state.busy || !state.page?.hasMore} onClick={state.next}>下一页</button></div>
    {state.page ? <small>已读 {byteLabel(state.page.scannedBytes)} / {byteLabel(state.page.totalBytes)}</small> : null}
    {state.earlierEvicted ? <button type="button" disabled={state.busy} onClick={state.reload}>从开头查看更早消息</button> : null}
  </footer>;
}
