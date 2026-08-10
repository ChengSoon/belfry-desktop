import { Bot, ChevronRight, Gauge, PanelLeftClose, Sparkles, SquareTerminal, X } from "lucide-react";
import type { CSSProperties } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import { ThemeToggle } from "../../theme/ThemeToggle";
import type { AgentAvailability, WorkspaceTab, WorkspaceTabKind } from "../contracts";
import { shortPath } from "../path";
import { SIDEBAR_WIDTH } from "../sidebarWidth";
import { groupTabsByProject, type ProjectGroup } from "../tabs";
import { NewSessionMenu } from "./NewSessionMenu";
import "../sidebar.css";

interface SidebarProps {
  agents: AgentAvailability[];
  tabs: WorkspaceTab[];
  activeId: string | null;
  foldedProjects: ReadonlySet<string>;
  onLaunch: (kind: WorkspaceTabKind) => void;
  onRefresh: () => Promise<void>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onToggleFold: (projectId: string) => void;
  onCollapse: () => void;
  onToggleUsage: () => void;
  usageOpen: boolean;
}

export function Sidebar({
  agents,
  tabs,
  activeId,
  foldedProjects,
  onLaunch,
  onRefresh,
  onActivate,
  onClose,
  onToggleFold,
  onCollapse,
  onToggleUsage,
  usageOpen,
}: SidebarProps) {
  const groups = groupTabsByProject(tabs);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(SIDEBAR_WIDTH);
  const sidebarStyle = { "--sidebar-width": `${width}px` } as CSSProperties;

  return (
    <aside className="sidebar" aria-label="会话" style={sidebarStyle}>
      <div className="sidebar-sessions">
        <div className="sessions-head">
          <span>会话</span>
          <NewSessionMenu agents={agents} onLaunch={onLaunch} onRefresh={onRefresh} />
        </div>
        <nav className="session-list" aria-label="会话列表">
          {groups.map((group) => (
            <SessionGroup
              activeId={activeId}
              folded={foldedProjects.has(group.project.id)}
              group={group}
              key={group.project.id}
              onActivate={onActivate}
              onClose={onClose}
              onToggleFold={onToggleFold}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar-foot">
        <ThemeToggle />
        <div className="sidebar-foot__actions">
          <button
            aria-pressed={usageOpen}
            className="icon-button icon-button--sm"
            onClick={onToggleUsage}
            title="额度用量 ⌘U"
            type="button"
          >
            <Gauge aria-hidden="true" size={ICON.md} />
          </button>
          <button className="icon-button icon-button--sm" onClick={onCollapse} title="收起侧栏 ⌘B" type="button">
            <PanelLeftClose aria-hidden="true" size={ICON.md} />
          </button>
        </div>
      </div>
      <PanelResizeHandle
        label="调整侧栏宽度"
        onCommit={commitWidth}
        onReset={resetWidth}
        onResize={setWidth}
        spec={SIDEBAR_WIDTH}
        width={width}
      />
    </aside>
  );
}

function SessionGroup({
  group,
  folded,
  activeId,
  onActivate,
  onClose,
  onToggleFold,
}: {
  group: ProjectGroup;
  folded: boolean;
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onToggleFold: (projectId: string) => void;
}) {
  // 折叠时活动会话被藏起来了，标题上留个点，不然看不出这组里有正在跑的东西。
  const hidesActive = folded && group.tabs.some((tab) => tab.id === activeId);

  return (
    <div className={`session-group${folded ? " is-folded" : ""}`}>
      <button
        aria-expanded={!folded}
        aria-label={`${group.project.name}，${group.tabs.length} 个会话`}
        className="session-group__head"
        onClick={() => onToggleFold(group.project.id)}
        title={shortPath(group.project.rootPath)}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="session-group__chevron" size={ICON.xs} />
        <span>{group.project.name}</span>
        {folded ? <i className="session-group__count" aria-hidden="true">{group.tabs.length}</i> : null}
        {hidesActive ? <i className="session-group__active-dot" aria-hidden="true" /> : null}
      </button>
      {folded ? null : group.tabs.map((tab) => (
        <SessionRow
          active={tab.id === activeId}
          key={tab.id}
          onActivate={onActivate}
          onClose={onClose}
          tab={tab}
        />
      ))}
    </div>
  );
}

function SessionRow({
  tab,
  active,
  onActivate,
  onClose,
}: {
  tab: WorkspaceTab;
  active: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const Icon = tab.kind === "shell" ? SquareTerminal : tab.kind === "codex" ? Bot : Sparkles;
  return (
    <div className={`session-row${active ? " is-active" : ""}`}>
      <button
        aria-current={active}
        className="session-row__main"
        onClick={() => onActivate(tab.id)}
        title={tab.error ?? tab.title}
        type="button"
      >
        <Icon aria-hidden="true" size={ICON.sm} />
        <span>{tab.title}</span>
        {tab.phase === "running" ? null : (
          <i className={`status-dot status-dot--${tab.phase}`} aria-label={phaseText(tab.phase)} />
        )}
      </button>
      <button
        className="session-row__close"
        onClick={() => onClose(tab.id)}
        title={`关闭 ${tab.title}`}
        type="button"
      >
        <X aria-hidden="true" size={ICON.xs} />
      </button>
    </div>
  );
}

function phaseText(phase: WorkspaceTab["phase"]) {
  return {
    idle: "空闲",
    creating: "启动中",
    running: "运行中",
    exited: "已退出",
    error: "错误",
  }[phase];
}
