import { useCallback, useMemo, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { TerminalViewport, type TerminalSnapshot } from "../../components/TerminalViewport";
import type { WorkspaceTab } from "../../workspace/contracts";
import type { DividerFrame, DropEdge, Rect } from "../contracts";
import { composeDropIndicator } from "../dropZone";
import type { SessionDrag } from "../useSessionDrag";
import { SplitDivider } from "./SplitDivider";
import { TerminalPane } from "./TerminalPane";
import "../layout.css";

interface TerminalStageProps {
  tabs: WorkspaceTab[];
  rects: Map<string, Rect>;
  dividers: DividerFrame[];
  split: boolean;
  activeTabId: string | null;
  drag: SessionDrag | null;
  stageRef: RefObject<HTMLDivElement | null>;
  onFocus: (tabId: string) => void;
  onClosePane: (tabId: string) => void;
  onDragStart: (tabId: string, event: PointerEvent) => void;
  onResize: (path: string, ratio: number) => void;
  onSnapshot: (id: string, snapshot: TerminalSnapshot) => void;
}

/** 隐藏的会话铺满整个舞台：尺寸不变，PTY 就不会因为进出分屏白挨一次 resize。 */
const OFFSCREEN: Rect = { left: 0, top: 0, width: 100, height: 100 };

export function TerminalStage({
  tabs,
  rects,
  dividers,
  split,
  activeTabId,
  drag,
  stageRef,
  onFocus,
  onClosePane,
  onDragStart,
  onResize,
  onSnapshot,
}: TerminalStageProps) {
  const indicator = useMemo(() => {
    if (drag?.target?.kind !== "pane") return null;
    const pane = rects.get(drag.target.tabId);
    return pane ? composeDropIndicator(pane, drag.target.edge) : null;
  }, [drag?.target, rects]);
  const edge = drag?.target?.kind === "pane" ? drag.target.edge : null;

  return (
    <div className="terminal-stage" ref={stageRef}>
      {tabs.map((tab) => {
        const rect = rects.get(tab.id);
        return (
          <TerminalPane
            dragging={drag?.tabId === tab.id}
            focused={tab.id === activeTabId}
            key={tab.id}
            onClose={onClosePane}
            onDragStart={onDragStart}
            onFocus={onFocus}
            onStage={rect !== undefined}
            rect={rect ?? OFFSCREEN}
            split={split && rect !== undefined}
            tab={tab}
          >
            <SessionTerminal onSnapshot={onSnapshot} tab={tab} visible={rect !== undefined} />
          </TerminalPane>
        );
      })}

      {dividers.map((divider) => (
        <SplitDivider
          divider={divider}
          key={divider.path || "root"}
          onResize={onResize}
          stageRef={stageRef}
        />
      ))}

      {indicator && edge ? <DropIndicator edge={edge} rect={indicator} /> : null}
    </div>
  );
}

function DropIndicator({ rect, edge }: { rect: Rect; edge: DropEdge }) {
  const style = {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  } as CSSProperties;
  return <div className={`drop-indicator drop-indicator--${edge}`} style={style} aria-hidden="true" />;
}

function SessionTerminal({
  tab,
  visible,
  onSnapshot,
}: {
  tab: WorkspaceTab;
  visible: boolean;
  onSnapshot: (id: string, snapshot: TerminalSnapshot) => void;
}) {
  // launch 变了就等于要换 cwd/profile，会重启 PTY——只能跟着这两个字段变。
  const launch = useMemo(
    () => ({ profileId: tab.profileId, cwd: tab.project.rootUri }),
    [tab.profileId, tab.project.rootUri],
  );
  const report = useCallback(
    (snapshot: TerminalSnapshot) => onSnapshot(tab.id, snapshot),
    [onSnapshot, tab.id],
  );
  return <TerminalViewport launch={launch} onSnapshot={report} visible={visible} />;
}
