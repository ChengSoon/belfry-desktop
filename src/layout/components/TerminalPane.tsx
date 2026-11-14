import { t, useTranslation } from "../../i18n";
import { Server, SquareTerminal, X } from "lucide-react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { ICON } from "../../theme/sizing";
import type { WorkspaceTab } from "../../workspace/contracts";
import { AGENT_ICONS } from "../../workspace/components/AgentIcons";
import { isAgentKind, usesTerminalStatus } from "../../agent/contracts";
import { sessionActivity, terminalStatusFor } from "../../agent/programStatus";
import { shortPath } from "../../workspace/path";
import type { Rect } from "../contracts";
import { HookStatusBar } from "../../agent/hooks/HookStatusBar";
import { SessionStatisticsControl } from "../../usage/session/SessionStatisticsControl";
import { statisticsTarget } from "../../usage/session/target";

interface TerminalPaneProps {
  tab: WorkspaceTab;
  rect: Rect;
  focused: boolean;
  /**
   * 会话是否真的落在舞台上。离屏挂着的会话整格都不该露脸——
   * visibility:hidden 只盖住了终端本身（.terminal-workspace），标题栏在它外面。
   */
  onStage: boolean;
  /** 分屏中：每格之间留间隙，并给出"移出分屏"的关闭按钮。 */
  split: boolean;
  dragging: boolean;
  onFocus: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDragStart: (tabId: string, event: PointerEvent) => void;
  children: ReactNode;
}

/**
 * 一个分屏窗格。定位全靠百分比绝对定位：终端在 React 树里的位置必须恒定，
 * 一旦因为布局变化被重新挂载，底层 PTY 就跟着被杀掉了。
 */
export function TerminalPane({
  tab,
  rect,
  focused,
  onStage,
  split,
  dragging,
  onFocus,
  onClose,
  onDragStart,
  children,
}: TerminalPaneProps) {
  useTranslation();
  const Icon = tab.kind === "shell" ? SquareTerminal : isAgentKind(tab.kind) ? AGENT_ICONS[tab.kind] : Server;
  const style = {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  } as CSSProperties;

  return (
    <div
      className={`terminal-pane${focused ? " is-focused" : ""}${onStage ? " is-onstage" : ""}${split ? " is-split" : ""}${dragging ? " is-dragging" : ""}`}
      // 捕获阶段接管：xterm 会吞掉冒泡上来的 pointerdown，点了不切焦点。
      onPointerDownCapture={() => onFocus(tab.id)}
      style={style}
    >
      {onStage ? (
        <div className="terminal-pane__bar" onPointerDown={(event) => onDragStart(tab.id, event)}>
          {split ? <><Icon aria-hidden="true" size={ICON.xs} />
            <span className="terminal-pane__title">{tab.title}</span></> : null}
          <span className={`terminal-pane__state terminal-pane__state--${paneState(tab)}`}>
            <i aria-hidden="true" />{t(`layout.TerminalPane.${paneState(tab)}`)}
          </span>
          {!split && tab.project.rootPath && tab.kind !== "ssh" ? <span className="terminal-pane__path" title={tab.project.rootPath}>{shortPath(tab.project.rootPath)}</span> : null}
          {isAgentKind(tab.kind) ? <div className="terminal-pane__session" onPointerDown={event => event.stopPropagation()}>
            <HookStatusBar agent={tab.kind} snapshot={tab.agentState ?? null} activity={tab.activity} phase={tab.phase} recovering={!!tab.restoreSessionId || !!tab.resumeSessionId} />
            <SessionStatisticsControl {...statisticsTarget(tab, tab.agentState ?? null)} visible={onStage} />
          </div> : null}
          {split ? (
            <button
              className="terminal-pane__close"
              // 关闭按钮在拖拽把手里，不拦住就会先起一个手势。
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onClose(tab.id)}
              title={t("layout.TerminalPane.text_31889cf993", { title: tab.title })}
              type="button"
            >
              <X aria-hidden="true" size={ICON.xs} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="terminal-pane__body">{children}</div>
    </div>
  );
}

/** 状态条上的一个词：进程不在跑时报进程，在跑时报它在干什么。和侧栏副标题同一套口径。 */
function paneState(tab: WorkspaceTab): "running" | "starting" | "exited" | "error" | "talking" | "awaiting" | "idle" | "unknown" {
  if (tab.phase === "creating") return "starting";
  if (tab.phase === "exited") return "exited";
  if (tab.phase === "error") return "error";
  if (tab.phase !== "running") return "idle";
  const report = terminalStatusFor(tab.kind, tab.agentState);
  if (usesTerminalStatus(tab.kind) && (!report || report.programStatus.state === "clear")) return "unknown";
  if (report?.programStatus.state === "error") return "error";
  const activity = sessionActivity(tab);
  if (activity === "awaiting-choice") return "awaiting";
  if (activity === "talking") return "talking";
  return "running";
}
