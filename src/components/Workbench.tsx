import { t, useTranslation } from "../i18n";
import type { PointerEvent, RefObject } from "react";
import { TerminalStage } from "../layout/components/TerminalStage";
import type { DividerFrame, Rect } from "../layout/contracts";
import type { SessionDrag } from "../layout/useSessionDrag";
import type { ShortcutPlatform } from "../shortcuts/resolveShortcut";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { ProjectWorkspace, RecentProject, WorkspaceTab } from "../workspace/contracts";
import "./workbench.css";
import type { TerminalSnapshot } from "./TerminalViewport";
import { WorkbenchToolbar } from "./WorkbenchToolbar";

export interface WorkbenchProps {
  activeProject: ProjectWorkspace | null;
  activeTabId: string | null;
  collapsed: boolean;
  collabOpen: boolean;
  /** 有几条派活等着确认。>0 时触发键上点个角标——面板关着也得看得见。 */
  collabWaiting: number;
  dividers: DividerFrame[];
  drag: SessionDrag | null;
  opening: boolean;
  previewOpen: boolean;
  pluginDockOpen: boolean;
  quickOpenOpen: boolean;
  recentProjects: RecentProject[];
  rects: Map<string, Rect>;
  shortcutGuideOpen: boolean;
  shortcutPlatform: ShortcutPlatform;
  split: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  tabs: WorkspaceTab[];
  onClosePane: (id: string) => void;
  onDragStart: (id: string, event: PointerEvent) => void;
  onFocus: (id: string) => void;
  onLaunchShell: () => void;
  onOpenFile: (tabId: string, path: string, line: number | null) => void;
  onOpenProject: (path: string | null) => Promise<void>;
  onOpenShortcutGuide: () => void;
  onRegisterTarget: (id: string, target: TerminalCommandTarget | null) => void;
  onRequestRemove: (project: RecentProject) => void;
  onResize: (path: string, ratio: number) => void;
  onRevealSidebar: () => void;
  onSnapshot: (id: string, snapshot: TerminalSnapshot) => void;
  onToggleCollab: () => void;
  onTogglePreview: () => void;
  onToggleQuickOpen: () => void;
  /** 顶栏会话标签切换；与侧栏点击走同一个入口。可选：静态渲染的单测不传。 */
  onActivateTab?: (id: string) => void;
  onSplitTab?: (id: string) => void;
  /** 当前命名工作区允许加入分屏的会话。 */
  splitTabIds?: string[];
}

export function Workbench(props: WorkbenchProps) {
  useTranslation();
  return (
    <section className="workbench" aria-label={t("components.Workbench.text_f9e02d3c13")}>
      <WorkbenchToolbar {...props} />
      <TerminalStage
        activeTabId={props.activeTabId}
        dividers={props.dividers}
        drag={props.drag}
        onClosePane={props.onClosePane}
        onCommandTarget={props.onRegisterTarget}
        onDragStart={props.onDragStart}
        onFocus={props.onFocus}
        onOpenFile={props.onOpenFile}
        onResize={props.onResize}
        onSnapshot={props.onSnapshot}
        rects={props.rects}
        split={props.split}
        stageRef={props.stageRef}
        tabs={props.tabs}
      />
      {props.rects.size === 0 ? <EmptyStage onLaunch={props.onLaunchShell} /> : null}
    </section>
  );
}

function EmptyStage({ onLaunch }: { onLaunch: () => void }) {
  useTranslation();
  return (
    <div className="empty-stage">
      <span className="empty-stage__eyebrow">{t("components.Workbench.text_da6facaf34")}</span>
      <h1>{t("components.Workbench.text_ee5aa07993")}</h1>
      <p>{t("components.Workbench.text_0c0f9b6b9f")}<br />{t("components.Workbench.text_060e29f925")}</p>
      <button onClick={onLaunch} type="button">{t("components.Workbench.text_3060812742")}</button>
      <small>{t("components.Workbench.text_54af0713cc")}</small>
    </div>
  );
}
