import { t, useTranslation } from "../i18n";
import { Columns2, Ellipsis, File, FileSearch, GitBranch, Keyboard, Moon, PanelLeftOpen, PanelRight, Plug, Search, Server, SquareTerminal, Sun, Users } from "lucide-react";
import type { ReactNode } from "react";
import { togglePluginDock, togglePluginLauncher } from "../plugins/workspace/events";
import { appShortcutChord, formatShortcutChord } from "../shortcuts/resolveShortcut";
import { useTheme } from "../theme/ThemeProvider";
import { ICON } from "../theme/sizing";
import { ProjectSwitcher } from "../workspace/components/ProjectSwitcher";
import type { WorkbenchProps } from "./Workbench";
import { useFlyout } from "./useFlyout";
import { useWorktreeReminder } from "../git/worktrees/WorktreeReminder";
import { branchLabel, useGitBranch } from "../git/useGitBranch";
import { isAgentKind, usesTerminalStatus } from "../agent/contracts";
import { sessionActivity, terminalStatusFor } from "../agent/programStatus";
import { terminalStatusLabel } from "../agent/programStatusLabel";
import { AGENT_ICONS } from "../workspace/components/AgentIcons";
import type { WorkspaceTab } from "../workspace/contracts";

export function WorkbenchToolbar(props: WorkbenchProps) {
  useTranslation();
  const flyout = useFlyout();
  const worktree = useWorktreeReminder({ project: props.activeProject, tabs: props.tabs, onOpen: props.onOpenProject });
  const moreLabel = [props.collabWaiting ? t("components.WorkbenchToolbar.text_6745834083", { collabWaiting: props.collabWaiting }) : t("components.WorkbenchToolbar.text_6ba91021aa"),
    worktree.count >= 2 ? t("git.WorktreeReminder.text_f324d6b965", { count: worktree.count }) : null].filter(Boolean).join(" · ");
  const shortcut = (key: string) => formatShortcutChord(appShortcutChord(props.shortcutPlatform, key));
  return (
    <header className="workbench-toolbar">
      {props.collapsed ? <button className="icon-button icon-button--sm" aria-label={t("components.WorkbenchToolbar.text_658ff1eade")} title={t("components.WorkbenchToolbar.text_8d70347006", { shortcut: shortcut("B") })}
        onClick={props.onRevealSidebar} type="button"><PanelLeftOpen size={ICON.md} /></button> : null}
      <div className="workbench-toolbar__project"><ProjectSwitcher onOpen={props.onOpenProject}
        onRequestRemove={props.onRequestRemove} opening={props.opening} project={props.activeProject} recentProjects={props.recentProjects} />
        <BranchCrumb rootPath={props.activeProject?.rootPath ?? null} /></div>
      <SessionTabs tabs={props.tabs} activeId={props.activeTabId} onActivate={props.onActivateTab} />
      <div className="workbench-toolbar__tools">
        <SplitSessionButton {...props} />
        <button className="icon-button icon-button--sm workbench-inspector" aria-label={t("components.WorkbenchToolbar.text_f3c5fe4dd2")} aria-expanded={props.previewOpen}
          title={t("components.WorkbenchToolbar.text_4f8ef4d52d")} onClick={props.onTogglePreview} type="button"><File aria-hidden="true" size={ICON.md} /></button>
        <div className="workbench-more" ref={flyout.root}>
          <button className="icon-button icon-button--sm" ref={flyout.trigger} aria-label={moreLabel}
            aria-controls={flyout.id} aria-expanded={flyout.open} aria-haspopup="dialog" title={t("components.WorkbenchToolbar.text_6ba91021aa")} onClick={flyout.toggle} type="button">
            <Ellipsis aria-hidden="true" size={ICON.md} />{props.collabWaiting || worktree.count >= 2 ? <i className="workbench-more__badge" aria-hidden="true" /> : null}
          </button>
          {flyout.open ? <div className="workbench-menu" id={flyout.id} role="dialog" aria-label={t("components.WorkbenchToolbar.text_6ba91021aa")}>
            <WorkbenchMenuItems {...props} worktreeCount={worktree.count} onOpenWorktrees={worktree.openManager}
              onSelect={() => { flyout.trigger.current?.focus(); flyout.close(); }} />
          </div> : null}
        </div>
      </div>
      {worktree.dialog}
    </header>
  );
}

function SplitSessionButton(props: WorkbenchProps) {
  const flyout = useFlyout();
  const candidates = props.tabs.filter(tab => tab.id !== props.activeTabId && !props.rects.has(tab.id)
    && (!props.splitTabIds || props.splitTabIds.includes(tab.id)));
  const available = Boolean(props.activeTabId && props.onSplitTab && candidates.length);
  return <div className="workbench-split-menu" ref={flyout.root}>
    <button className="icon-button icon-button--sm workbench-split" type="button" ref={flyout.trigger}
      aria-label={t("components.WorkbenchToolbar.split")} title={t(available ? "components.WorkbenchToolbar.split" : "components.WorkbenchToolbar.splitNeedsSession")}
      disabled={!available} aria-expanded={flyout.open} aria-controls={flyout.id} aria-haspopup="dialog" onClick={flyout.toggle}>
      <Columns2 aria-hidden="true" size={ICON.md} />
    </button>
    {flyout.open ? <div className="workbench-menu" id={flyout.id} role="dialog" aria-label={t("components.WorkbenchToolbar.split")}>
      <p className="workbench-menu__heading">{t("components.WorkbenchToolbar.splitChoose")}</p>
      {candidates.map((tab, index) => <ToolItem key={tab.id} icon={tab.kind === "shell" ? SquareTerminal : isAgentKind(tab.kind) ? AGENT_ICONS[tab.kind] : Server}
        focus={index === 0} onClick={() => { flyout.close(); props.onSplitTab?.(tab.id); }}>{tab.agentName ?? tab.title}</ToolItem>)}
    </div> : null}
  </div>;
}

/**
 * 面包屑的第二段：当前项目所在分支，分离 HEAD 时显示短提交号。不是 Git 仓库或读不到时隐藏。
 * 这里只是位置提示，出错时不该占一格去报错，Git 面板里有完整的状态和重试。
 */
function BranchCrumb({ rootPath }: { rootPath: string | null }) {
  useTranslation();
  const label = branchLabel(useGitBranch(rootPath));
  if (!label) return null;
  return <span className="workbench-crumb__branch" title={t(label.detached ? "components.WorkbenchToolbar.detachedHead" : "components.WorkbenchToolbar.branch", { branch: label.text })}>
    <span className="workbench-crumb__sep" aria-hidden="true">/</span>
    <GitBranch aria-hidden="true" size={ICON.xs} /><span>{label.text}</span>
  </span>;
}

/**
 * 顶栏标签：和当前会话同一项目的会话，最多 6 个，点一下就切过去（与侧栏同一个 activate）。
 * 侧栏仍是完整列表和拖拽分屏的入口；这里只放「同项目里来回切」这一件高频的事。
 * 没传 onActivate 时（单测静态渲染）只显示当前会话。
 */
const MAX_TABS = 6;
function SessionTabs({ tabs, activeId, onActivate }: { tabs: WorkspaceTab[]; activeId: string | null; onActivate?: (id: string) => void }) {
  useTranslation();
  const active = tabs.find((tab) => tab.id === activeId) ?? null;
  if (!active) return null;
  const visible = (onActivate ? sameProject(tabs, active) : [active]).slice(0, MAX_TABS);
  if (!visible.includes(active)) visible[visible.length - 1] = active;
  return <div className="workbench-tabs" role="group" aria-label={t("components.WorkbenchToolbar.projectSessions")}>
    {visible.map((tab) => <SessionTab key={tab.id} tab={tab} active={tab.id === activeId} onActivate={onActivate} />)}
  </div>;
}

function sameProject(tabs: WorkspaceTab[], active: WorkspaceTab) {
  return active.kind === "ssh" ? [active] : tabs.filter((tab) => tab.kind !== "ssh" && tab.project.id === active.project.id);
}

function SessionTab({ tab, active, onActivate }: { tab: WorkspaceTab; active: boolean; onActivate?: (id: string) => void }) {
  useTranslation();
  const Icon = tab.kind === "shell" ? SquareTerminal : isAgentKind(tab.kind) ? AGENT_ICONS[tab.kind] : Server;
  const name = tab.agentName ?? tab.title;
  const live = tab.phase === "running";
  const activity = sessionActivity(tab);
  const protocol = usesTerminalStatus(tab.kind);
  const state = terminalStatusFor(tab.kind, tab.agentState)?.programStatus.state;
  const dotClass = protocol && (!state || state === "clear") ? " is-unknown" : state === "error" ? " is-error"
    : activity === "awaiting-choice" ? " is-awaiting" : "";
  const label = live && protocol ? `${name} · ${terminalStatusLabel(tab.kind, tab.agentState)}` : name;
  return <button type="button" aria-current={active ? "page" : undefined} className={`workbench-tab${active ? " is-active" : ""}`}
    title={label} aria-label={label} onClick={onActivate ? () => onActivate(tab.id) : undefined}>
    <Icon aria-hidden="true" size={ICON.xs} /><span>{name}</span>
    {live && activity !== "idle" ? <i className={`workbench-tab__dot${dotClass}`} aria-hidden="true" />
      : live && active ? <i className="workbench-tab__dot" aria-hidden="true" /> : null}
  </button>;
}

export function WorkbenchMenuItems(props: WorkbenchProps & { onSelect: () => void; worktreeCount?: number; onOpenWorktrees?: () => void }) {
  useTranslation();
  const run = (action: () => void) => () => { props.onSelect(); action(); };
  return <>
    <ToolItem icon={Users} active={props.collabOpen} focus onClick={run(props.onToggleCollab)}>{t("components.WorkbenchToolbar.text_18a62218d6")}{props.collabWaiting ? <small>{t("components.WorkbenchToolbar.pendingConfirmations", { count: props.collabWaiting })}</small> : null}
    </ToolItem>
    <ToolItem icon={Plug} onClick={run(togglePluginLauncher)}>{t("components.WorkbenchToolbar.text_85ef04ad0c")}<kbd>Alt+Space</kbd></ToolItem>
    <ToolItem icon={PanelRight} active={props.pluginDockOpen} onClick={run(togglePluginDock)}>{t("components.WorkbenchToolbar.text_75288484d2")}</ToolItem>
      <ToolItem icon={Search} active={props.quickOpenOpen} onClick={run(props.onToggleQuickOpen)}>Quick Open</ToolItem>
      <ToolItem icon={FileSearch} active={props.previewOpen} onClick={run(props.onTogglePreview)}>{t("components.WorkbenchToolbar.text_4f8ef4d52d")}</ToolItem>
    {props.worktreeCount && props.worktreeCount >= 2 && props.onOpenWorktrees ? <>
      <div className="workbench-menu__divider" />
      <p className="workbench-menu__note">{t("git.WorktreeReminder.text_3d68d81b46", { count: props.worktreeCount })}</p>
      <ToolItem icon={GitBranch} onClick={run(props.onOpenWorktrees)}>{t("git.WorktreeReminder.text_31d678da77")}</ToolItem>
    </> : null}
    <div className="workbench-menu__divider" />
    <ToolItem icon={Keyboard} active={props.shortcutGuideOpen} onClick={run(props.onOpenShortcutGuide)}>{t("components.WorkbenchToolbar.text_c813e695f2")}</ToolItem>
    <ThemeMenuItem onSelect={props.onSelect} />
  </>;
}

function ThemeMenuItem({ onSelect }: { onSelect: () => void }) {
  useTranslation();
  const { mode, toggle } = useTheme();
  return <ToolItem icon={mode === "light" ? Moon : Sun} onClick={() => { onSelect(); toggle(); }}>
    {mode === "light" ? t("components.WorkbenchToolbar.text_5c00d3bba0") : t("components.WorkbenchToolbar.text_4d107af77a")}
  </ToolItem>;
}

function ToolItem({ icon: Icon, children, onClick, active, focus }: {
  icon: typeof Search | (typeof AGENT_ICONS)[keyof typeof AGENT_ICONS]; children: ReactNode; onClick: () => void; active?: boolean; focus?: boolean;
}) {
  useTranslation();
  return <button className="workbench-menu__item" type="button" aria-pressed={active} data-flyout-focus={focus || undefined}
    onMouseDown={(event) => event.stopPropagation()} onClick={onClick}>
    <Icon aria-hidden="true" size={ICON.sm} /><span>{children}</span>
  </button>;
}
