import { Bot, Gauge, PanelLeftClose, Sparkles, SquareTerminal, X } from "lucide-react";
import { ThemeToggle } from "../../theme/ThemeToggle";
import type { AgentAvailability, WorkspaceTab, WorkspaceTabKind } from "../contracts";
import { groupTabsByProject } from "../tabs";
import { NewSessionMenu } from "./NewSessionMenu";
import "../sidebar.css";

interface SidebarProps {
  agents: AgentAvailability[];
  tabs: WorkspaceTab[];
  activeId: string | null;
  onLaunch: (kind: WorkspaceTabKind) => void;
  onRefresh: () => Promise<void>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onCollapse: () => void;
  onToggleUsage: () => void;
  usageOpen: boolean;
}

export function Sidebar({
  agents,
  tabs,
  activeId,
  onLaunch,
  onRefresh,
  onActivate,
  onClose,
  onCollapse,
  onToggleUsage,
  usageOpen,
}: SidebarProps) {
  const groups = groupTabsByProject(tabs);

  return (
    <aside className="sidebar" aria-label="会话">
      <div className="sidebar-sessions">
        <div className="sessions-head">
          <span>会话</span>
          <NewSessionMenu agents={agents} onLaunch={onLaunch} onRefresh={onRefresh} />
        </div>
        <nav className="session-list" aria-label="会话列表">
          {groups.map((group) => (
            <div className="session-group" key={group.project.id}>
              <div className="session-group__head" title={group.project.rootPath}>
                {group.project.name}
              </div>
              {group.tabs.map((tab) => (
                <SessionRow
                  active={tab.id === activeId}
                  key={tab.id}
                  onActivate={onActivate}
                  onClose={onClose}
                  tab={tab}
                />
              ))}
            </div>
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
            <Gauge aria-hidden="true" size={14} />
          </button>
          <button className="icon-button icon-button--sm" onClick={onCollapse} title="收起侧栏 ⌘B" type="button">
            <PanelLeftClose aria-hidden="true" size={14} />
          </button>
        </div>
      </div>
    </aside>
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
        <Icon aria-hidden="true" size={13} />
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
        <X aria-hidden="true" size={12} />
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
