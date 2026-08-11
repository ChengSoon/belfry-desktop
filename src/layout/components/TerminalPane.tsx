import { SquareTerminal, X } from "lucide-react";
import type { CSSProperties, PointerEvent, ReactNode } from "react";
import { ICON } from "../../theme/sizing";
import type { WorkspaceTab } from "../../workspace/contracts";
import { ClaudeIcon, CodexIcon } from "../../workspace/components/AgentIcons";
import type { Rect } from "../contracts";

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
  const Icon = tab.kind === "shell" ? SquareTerminal : tab.kind === "codex" ? CodexIcon : ClaudeIcon;
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
          <Icon aria-hidden="true" size={ICON.xs} />
          <span className="terminal-pane__title">{tab.title}</span>
          {split ? (
            <button
              className="terminal-pane__close"
              // 关闭按钮在拖拽把手里，不拦住就会先起一个手势。
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onClose(tab.id)}
              title={`从分屏移出 ${tab.title}`}
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
