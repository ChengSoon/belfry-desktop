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
  /** 只有一个窗格时不显示标题栏和关闭按钮——那就是普通的单终端视图。 */
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
      className={`terminal-pane${focused ? " is-focused" : ""}${split ? " is-split" : ""}${dragging ? " is-dragging" : ""}`}
      // 捕获阶段接管：xterm 会吞掉冒泡上来的 pointerdown，点了不切焦点。
      onPointerDownCapture={() => onFocus(tab.id)}
      style={style}
    >
      {split ? (
        <div className="terminal-pane__bar" onPointerDown={(event) => onDragStart(tab.id, event)}>
          <Icon aria-hidden="true" size={ICON.xs} />
          <span className="terminal-pane__title">{tab.title}</span>
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
        </div>
      ) : null}
      <div className="terminal-pane__body">{children}</div>
    </div>
  );
}
