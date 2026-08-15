import {
  AlertTriangle,
  Check,
  History,
  ListChecks,
  Play,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useState, type CSSProperties } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import { agentLabel, formatMoment, formatRelative } from "../../usage/format";
import type { AgentKind } from "../../workspace/contracts";
import { failureLabel } from "../../workspace/errors";
import type { HistorySession } from "../contracts";
import { useHistory } from "../useHistory";
import { HISTORY_WIDTH } from "../historyWidth";
import "../history.css";

interface HistoryPanelProps {
  onClose: () => void;
  /** 选中一条历史会话：新开会话框继续它。 */
  onResume: (agent: AgentKind, session: HistorySession) => void;
}

const AGENTS: AgentKind[] = ["codex", "claude"];

export function HistoryPanel({ onClose, onResume }: HistoryPanelProps) {
  const history = useHistory(true);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pendingClear, setPendingClear] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<HistorySession | null>(null);
  const [pendingDeleteMany, setPendingDeleteMany] = useState(false);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(HISTORY_WIDTH);
  const panelStyle = { "--history-width": `${width}px` } as CSSProperties;
  const count = history.sessions.length;
  const allSelected = count > 0 && selected.size === count;

  // 切换 Agent 时列表整个换掉，残留的选中 id 不该继续生效。
  const switchAgent = useCallback((agent: AgentKind) => {
    setSelected(new Set());
    history.setAgent(agent);
  }, [history.setAgent]);

  const enterSelecting = useCallback(() => setSelecting(true), []);
  const finishSelecting = useCallback(() => {
    setSelecting(false);
    setSelected(new Set());
  }, []);

  const toggleSelected = useCallback((sessionId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((current) => {
      if (current.size === history.sessions.length) return new Set();
      return new Set(history.sessions.map((session) => session.id));
    });
  }, [history.sessions]);

  const resumeSelected = useCallback(() => {
    for (const session of history.sessions) {
      if (selected.has(session.id)) onResume(history.agent, session);
    }
  }, [history.agent, history.sessions, onResume, selected]);

  return (
    <section className="history-panel" aria-label="历史会话" style={panelStyle}>
      <header className="history-head">
        <History aria-hidden="true" size={ICON.md} />
        <h2>历史会话</h2>
        <button
          className="icon-button icon-button--sm"
          disabled={history.loading}
          onClick={() => void history.reload()}
          title="重新扫描会话日志"
          type="button"
        >
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        {!selecting ? (
          <button
            className="icon-button icon-button--sm"
            disabled={history.loading || count === 0 || history.clearing}
            onClick={() => setPendingClear(true)}
            title="清空全部历史会话"
            type="button"
          >
            <Trash2 aria-hidden="true" size={ICON.sm} />
          </button>
        ) : null}
        <button
          aria-pressed={selecting}
          className={`icon-button icon-button--sm${selecting ? " is-active" : ""}`}
          disabled={count === 0 || history.loading}
          onClick={selecting ? finishSelecting : enterSelecting}
          title={selecting ? "完成选择" : "多选"}
          type="button"
        >
          {selecting ? <Check aria-hidden="true" size={ICON.sm} /> : <ListChecks aria-hidden="true" size={ICON.sm} />}
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title="关闭" type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      <div className="history-filters">
        <div className="history-segments" role="group" aria-label="选择 Agent">
          {AGENTS.map((agent) => (
            <button
              aria-pressed={history.agent === agent}
              className={history.agent === agent ? "is-active" : undefined}
              key={agent}
              onClick={() => switchAgent(agent)}
              type="button"
            >
              {agentLabel(agent)}
            </button>
          ))}
        </div>
      </div>

      <div className="history-toolstrip">
        {history.failure ? (
          <p className="history-error" role="alert">
            <AlertTriangle aria-hidden="true" size={ICON.sm} />
            {failureLabel(history.failure)}
          </p>
        ) : null}
        {selecting ? (
          <div className="history-toolbar">
            <span className="history-toolbar__count">
              已选 {selected.size} / {count}
            </span>
            <button
              className="history-toolbar__action"
              onClick={toggleAll}
              type="button"
            >
              {allSelected ? "取消全选" : "全选"}
            </button>
            <span className="history-toolbar__spacer" />
            <button
              className="history-toolbar__action"
              disabled={selected.size === 0}
              onClick={resumeSelected}
              title="新开会话框继续选中的会话"
              type="button"
            >
              <Play aria-hidden="true" size={ICON.xs} />
              打开
            </button>
            <button
              className="history-toolbar__action history-toolbar__action--danger"
              disabled={selected.size === 0 || history.clearing}
              onClick={() => setPendingDeleteMany(true)}
              title="删除选中的历史会话"
              type="button"
            >
              <Trash2 aria-hidden="true" size={ICON.xs} />
              删除
            </button>
          </div>
        ) : null}
      </div>

      <div className="history-body">
        {history.loading ? <p className="history-hint">正在扫描会话日志…</p> : null}
        {!history.loading && count === 0 ? (
          <p className="history-hint">
            {agentLabel(history.agent)} 还没有历史会话。会话日志来自本机
            {history.agent === "codex" ? " ~/.codex/sessions" : " ~/.claude/projects"}
            ，跑过会话后才会出现。
          </p>
        ) : null}
        {count > 0 ? (
          <ul className="history-list">
            {history.sessions.map((session) => {
              const isSelected = selected.has(session.id);
              return (
                <li
                  className={`history-item${isSelected ? " is-selected" : ""}`}
                  key={session.id}
                >
                  {selecting ? (
                    <input
                      aria-label={`选择 ${session.title || "无标题会话"}`}
                      checked={isSelected}
                      className="history-item__check"
                      onChange={() => toggleSelected(session.id)}
                      type="checkbox"
                    />
                  ) : null}
                  <button
                    aria-pressed={selecting ? isSelected : undefined}
                    className="history-item__main"
                    onClick={() => {
                      if (selecting) toggleSelected(session.id);
                      else onResume(history.agent, session);
                    }}
                    title={selecting
                      ? (isSelected ? "取消选择" : "选择该会话")
                      : `打开 ${formatMoment(session.lastActiveAt) ?? "历史会话"}`}
                    type="button"
                  >
                    <span className="history-item__title">
                      {session.title || "无标题会话"}
                    </span>
                    <span className="history-item__meta">
                      {session.cwd ?? "未知目录"} · {formatRelative(session.lastActiveAt) ?? "很久以前"}
                    </span>
                  </button>
                  <div className="history-item__actions">
                    <button
                      aria-label={`打开 ${session.title || "无标题会话"}`}
                      className="icon-button icon-button--sm"
                      onClick={() => onResume(history.agent, session)}
                      title="新开会话框继续该会话"
                      type="button"
                    >
                      <Play aria-hidden="true" size={ICON.xs} />
                    </button>
                    <button
                      aria-label={`删除 ${session.title || "无标题会话"}`}
                      className="icon-button icon-button--sm history-item__delete"
                      disabled={history.busyId === session.id || history.clearing}
                      onClick={() => setPendingDelete(session)}
                      title="删除该历史会话"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={ICON.xs} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      <PanelResizeHandle
        label="调整历史会话面板宽度"
        onCommit={commitWidth}
        onReset={resetWidth}
        onResize={setWidth}
        spec={HISTORY_WIDTH}
        width={width}
      />

      {pendingDelete ? (
        <ConfirmDialog
          body="将删除这条历史会话日志，且无法恢复。正在运行的会话不受影响。"
          confirmLabel="删除"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const session = pendingDelete;
            setPendingDelete(null);
            void history.removeOne(session.id);
          }}
          title={`删除"${pendingDelete.title || "无标题会话"}"？`}
        />
      ) : null}

      {pendingDeleteMany ? (
        <ConfirmDialog
          body={`将删除选中的 ${selected.size} 条历史会话日志，且无法恢复。正在运行的会话不受影响。`}
          confirmLabel="删除"
          onCancel={() => setPendingDeleteMany(false)}
          onConfirm={() => {
            const ids = [...selected];
            setPendingDeleteMany(false);
            setSelected(new Set());
            void history.removeMany(ids);
          }}
          title={`删除选中的 ${selected.size} 条历史会话？`}
        />
      ) : null}

      {pendingClear ? (
        <ConfirmDialog
          body={`将删除 ${agentLabel(history.agent)} 的全部 ${count} 条历史会话日志，且无法恢复。正在运行的会话不受影响。`}
          confirmLabel="清空"
          onCancel={() => setPendingClear(false)}
          onConfirm={() => {
            setPendingClear(false);
            void history.clearAll();
          }}
          title={`清空 ${agentLabel(history.agent)} 历史会话？`}
        />
      ) : null}
    </section>
  );
}
