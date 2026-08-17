import { ChevronRight, Download, Gauge, History, PanelLeftClose, Pencil, Server, Settings, Settings2, SquareTerminal, X } from "lucide-react";
import { useRef, useState, type CSSProperties, type PointerEvent, type Ref } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import {
  appShortcutChord,
  formatShortcutChord,
  shortcutPlatform,
} from "../../shortcuts/resolveShortcut";
import { ThemeToggle } from "../../theme/ThemeToggle";
import type { UpdaterState } from "../../updater/contracts";
import type { SshLaunch } from "../../terminal/contracts";
import type { AgentAvailability, WorkspaceTab, WorkspaceTabKind } from "../contracts";
import { shortPath } from "../path";
import { SIDEBAR_WIDTH } from "../sidebarWidth";
import { groupTabsByProject, type ProjectGroup } from "../tabs";
import { ClaudeIcon, CodexIcon } from "./AgentIcons";
import { NewSessionMenu } from "./NewSessionMenu";
import { SshDialog } from "./SshDialog";
import "../sidebar.css";

interface SidebarProps {
  agents: AgentAvailability[];
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** 正被拖着的会话，拖拽期间在列表里淡下去。 */
  draggingId: string | null;
  foldedProjects: ReadonlySet<string>;
  onLaunch: (kind: WorkspaceTabKind) => void;
  onLaunchSsh: (target: SshLaunch) => void;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onRefresh: () => Promise<void>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, customTitle: string | null) => void;
  onDragStart: (id: string, event: PointerEvent) => void;
  /** 拖完那下 pointerup 还会带出一次 click，返回 true 表示这次点击该被吞掉。 */
  onConsumeClick: () => boolean;
  onToggleFold: (projectId: string) => void;
  onCollapse: () => void;
  onToggleUsage: () => void;
  onToggleHistory: () => void;
  onOpenUpdater: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  usageOpen: boolean;
  historyOpen: boolean;
  updaterOpen: boolean;
  updaterState: UpdaterState;
  /** 命中测试要拿侧栏的真实矩形，才能判断会话被拖回了列表。 */
  ref?: Ref<HTMLElement>;
  /** 当前拖拽正悬在侧栏上：松手就把这个会话从舞台摘掉。 */
  ejecting?: boolean;
}

export function Sidebar({
  agents,
  tabs,
  activeId,
  draggingId,
  ejecting = false,
  foldedProjects,
  onLaunch,
  onLaunchSsh,
  onUpdateSsh,
  onRefresh,
  onActivate,
  onClose,
  onRename,
  onDragStart,
  onConsumeClick,
  onToggleFold,
  onCollapse,
  onToggleUsage,
  onToggleHistory,
  onOpenUpdater,
  onOpenSettings,
  ref,
  settingsOpen,
  updaterOpen,
  updaterState,
  usageOpen,
  historyOpen,
}: SidebarProps) {
  const groups = groupTabsByProject(tabs);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(SIDEBAR_WIDTH);
  const sidebarStyle = { "--sidebar-width": `${width}px` } as CSSProperties;
  const platform = shortcutPlatform(document.documentElement.dataset.platform);

  return (
    <aside
      className={`sidebar${ejecting ? " is-eject-target" : ""}`}
      aria-label="会话"
      ref={ref}
      style={sidebarStyle}
    >
      <div className="sidebar-sessions">
        <div className="sessions-head">
          <span>会话</span>
          <NewSessionMenu
            agents={agents}
            onLaunch={onLaunch}
            onLaunchSsh={onLaunchSsh}
            onRefresh={onRefresh}
            shellShortcut={formatShortcutChord(appShortcutChord(platform, "T"))}
          />
        </div>
        <nav className="session-list" aria-label="会话列表">
          {groups.map((group) => (
            <SessionGroup
              activeId={activeId}
              draggingId={draggingId}
              folded={foldedProjects.has(group.project.id)}
              group={group}
              key={group.project.id}
              onActivate={onActivate}
              onClose={onClose}
              onRename={onRename}
              onUpdateSsh={onUpdateSsh}
              onConsumeClick={onConsumeClick}
              onDragStart={onDragStart}
              onToggleFold={onToggleFold}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar-foot">
        <ThemeToggle />
        <div className="sidebar-foot__actions">
          {showUpdaterTrigger(updaterState, updaterOpen) ? (
            <button
              aria-label={updateButtonLabel(updaterState)}
              aria-pressed={updaterOpen}
              className={`icon-button icon-button--sm updater-trigger updater-trigger--${updaterState.status}`}
              onClick={onOpenUpdater}
              title={updateButtonLabel(updaterState)}
              type="button"
            >
              <Download aria-hidden="true" size={ICON.md} />
              {updaterState.status === "available" ? <i aria-hidden="true" /> : null}
            </button>
          ) : null}
          <button
            aria-pressed={settingsOpen}
            className="icon-button icon-button--sm"
            onClick={onOpenSettings}
            title={`设置 ${formatShortcutChord(appShortcutChord(platform, ","))}`}
            type="button"
          >
            <Settings aria-hidden="true" size={ICON.md} />
          </button>
          <button
            aria-pressed={usageOpen}
            className="icon-button icon-button--sm"
            onClick={onToggleUsage}
            title={`额度用量 ${formatShortcutChord(appShortcutChord(platform, "U"))}`}
            type="button"
          >
            <Gauge aria-hidden="true" size={ICON.md} />
          </button>
          <button
            aria-pressed={historyOpen}
            className="icon-button icon-button--sm"
            onClick={onToggleHistory}
            title={`历史会话 ${formatShortcutChord(appShortcutChord(platform, "H", true))}`}
            type="button"
          >
            <History aria-hidden="true" size={ICON.md} />
          </button>
          <button
            className="icon-button icon-button--sm"
            onClick={onCollapse}
            title={`收起侧栏 ${formatShortcutChord(appShortcutChord(platform, "B"))}`}
            type="button"
          >
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

/**
 * 平时不占位：只有远程确实有新版本、或更新已经在下载安装时才露出入口。
 * 面板开着时一并保留——下载失败会把状态打回 error，此时面板还开着，
 * 按钮跟着消失的话，关掉面板前那一下会看到入口凭空不见。
 */
function showUpdaterTrigger(state: UpdaterState, open: boolean) {
  if (open) return true;
  return state.status === "available" || state.status === "downloading" || state.status === "installing";
}

function updateButtonLabel(state: UpdaterState) {
  if (state.status === "available") return `发现 Belfry v${state.availableVersion}`;
  if (state.status === "downloading" || state.status === "installing") return "正在更新 Belfry";
  if (state.status === "checking") return "正在检查更新";
  if (state.status === "error") return "检查更新失败，点击重试";
  return "检查更新";
}

function SessionGroup({
  group,
  folded,
  activeId,
  draggingId,
  onActivate,
  onClose,
  onRename,
  onUpdateSsh,
  onConsumeClick,
  onDragStart,
  onToggleFold,
}: {
  group: ProjectGroup;
  folded: boolean;
  activeId: string | null;
  draggingId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, customTitle: string | null) => void;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onConsumeClick: () => boolean;
  onDragStart: (id: string, event: PointerEvent) => void;
  onToggleFold: (projectId: string) => void;
}) {
  // 折叠时组里的会话全藏起来了，标题上留个点，不然看不出这组里有正在跑的东西。
  const dot = folded ? foldedDot(group.tabs, activeId) : null;

  return (
    <div className={`session-group${folded ? " is-folded" : ""}`}>
      <button
        aria-expanded={!folded}
        aria-label={`${group.project.name}，${group.tabs.length} 个会话${dot === "awaiting" ? "，有会话等待选择" : ""}`}
        className="session-group__head"
        onClick={() => onToggleFold(group.project.id)}
        title={group.project.rootPath ? shortPath(group.project.rootPath) : "SSH 会话"}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="session-group__chevron" size={ICON.xs} />
        {group.project.id === "ssh" ? <Server aria-hidden="true" size={ICON.xs} /> : null}
        <span>{group.project.name}</span>
        {folded ? <i className="session-group__count" aria-hidden="true">{group.tabs.length}</i> : null}
        {dot ? <i className={`session-group__dot session-group__dot--${dot}`} aria-hidden="true" /> : null}
      </button>
      {folded ? null : group.tabs.map((tab) => (
        <SessionRow
          active={tab.id === activeId}
          dragging={tab.id === draggingId}
          key={tab.id}
          onActivate={onActivate}
          onClose={onClose}
          onRename={onRename}
          onUpdateSsh={onUpdateSsh}
          onConsumeClick={onConsumeClick}
          onDragStart={onDragStart}
          tab={tab}
        />
      ))}
    </div>
  );
}

function SessionRow({
  tab,
  active,
  dragging,
  onActivate,
  onClose,
  onRename,
  onUpdateSsh,
  onConsumeClick,
  onDragStart,
}: {
  tab: WorkspaceTab;
  active: boolean;
  dragging: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, customTitle: string | null) => void;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onConsumeClick: () => boolean;
  onDragStart: (id: string, event: PointerEvent) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [sshEditorOpen, setSshEditorOpen] = useState(false);
  const sshEditRef = useRef<HTMLButtonElement>(null);
  // Escape 取消后 input 卸载会补发一次 blur，不挡一下会把"取消"变成"提交"。
  const dismissed = useRef(false);
  const Icon = tab.kind === "shell"
    ? SquareTerminal
    : tab.kind === "codex"
      ? CodexIcon
      : tab.kind === "claude"
        ? ClaudeIcon
        : Server;
  const startEditing = () => {
    dismissed.current = false;
    setDraft(tab.title);
    setEditing(true);
  };
  const commit = () => {
    if (dismissed.current) return;
    dismissed.current = true;
    setEditing(false);
    onRename(tab.id, draft.trim() || null);
  };
  const cancel = () => {
    dismissed.current = true;
    setEditing(false);
  };
  const openSshEditor = () => {
    if (tab.sshTarget) setSshEditorOpen(true);
  };
  const closeSshEditor = () => {
    setSshEditorOpen(false);
    window.requestAnimationFrame(() => sshEditRef.current?.focus());
  };
  // 只有 exited 褪色。error 也是"进程没了"，但它要你去看，褪成灰会把行尾那个红点的分量抵掉。
  const dim = tab.phase === "exited";
  return (
    <>
      <div className={`session-row${active ? " is-active" : ""}${dim ? " is-dim" : ""}${dragging ? " is-dragging" : ""}${tab.kind === "ssh" ? " session-row--ssh" : ""}`}>
      {editing ? (
        <div className="session-row__main session-row__main--editing">
          <Icon aria-hidden="true" size={ICON.sm} />
          <input
            aria-label="会话显示名"
            autoFocus
            maxLength={64}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                event.preventDefault();
                cancel();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            value={draft}
          />
        </div>
      ) : (
        <button
          aria-current={active}
          aria-label={`${tab.title}，${statusText(tab)}`}
          className="session-row__main"
          // 拖到终端上分屏；没拖动就是普通的切换点击。
          onClick={() => {
            if (!onConsumeClick()) onActivate(tab.id);
          }}
          onDoubleClick={tab.kind === "ssh" ? startEditing : undefined}
          onPointerDown={(event) => onDragStart(tab.id, event)}
          title={rowTitle(tab)}
          type="button"
        >
          <Icon aria-hidden="true" size={ICON.sm} />
          <span>{tab.title}</span>
        </button>
      )}
      <div className={`session-row__tail${tab.kind === "ssh" ? " session-row__tail--wide" : ""}`}>
        {tab.kind === "ssh" ? (
          <>
            <button
              aria-label="编辑 SSH 连接"
              className="session-row__edit"
              onClick={openSshEditor}
              ref={sshEditRef}
              title="编辑 SSH 连接"
              type="button"
            >
              <Settings2 aria-hidden="true" size={ICON.xs} />
            </button>
            <button
              aria-label="重命名会话"
              className="session-row__rename"
              onClick={startEditing}
              title="重命名会话"
              type="button"
            >
              <Pencil aria-hidden="true" size={ICON.xs} />
            </button>
          </>
        ) : null}
        <SessionDot tab={tab} />
        <button
          className="session-row__close"
          onClick={() => onClose(tab.id)}
          title={`关闭 ${tab.title}`}
          type="button"
        >
          <X aria-hidden="true" size={ICON.xs} />
        </button>
      </div>
      </div>
      {sshEditorOpen && tab.sshTarget ? (
        <SshDialog
          initialRememberPassword={tab.sshTarget.rememberPassword}
          initialTarget={tab.sshTarget}
          mode="edit"
          onCancel={closeSshEditor}
          onConnect={(target) => {
            closeSshEditor();
            onUpdateSsh(tab.id, target);
          }}
        />
      ) : null}
    </>
  );
}

/** SSH 会话可以双击改名，把提示挂在悬停 tooltip 上。 */
function rowTitle(tab: WorkspaceTab) {
  if (tab.error) return tab.error;
  if (tab.kind === "ssh") return `双击重命名 · 点击设置编辑连接 · ${tab.title}`;
  return tab.titleHint ?? tab.title;
}

/**
 * 一条会话最多一个点：进程不正常时报 phase，正常跑着时报它在干什么。
 * 跑得好好的又没在忙就不显示——列表安静下来，剩下的点才有分量。
 * exited 同样不显示：整行已经褪成灰的了（.is-dim），再点一个灰点是同一件事说两遍。
 */
function SessionDot({ tab }: { tab: WorkspaceTab }) {
  if (tab.phase === "exited") return null;
  if (tab.phase !== "running") {
    return <i className={`status-dot status-dot--${tab.phase}`} aria-hidden="true" />;
  }
  if (tab.activity === "idle") return null;
  return <i className={`activity-dot activity-dot--${tab.activity}`} aria-hidden="true" />;
}

/** 点是画给眼睛看的，状态文字挂在会话按钮的 aria-label 上——读屏一次就把名字和状态都念完。 */
function statusText(tab: WorkspaceTab) {
  if (tab.phase !== "running" || tab.activity === "idle") return phaseText(tab.phase);
  return activityText(tab.activity);
}

/** 等你按键的组优先标出来：那是唯一需要立刻动手的状态，盖过"活动会话在这组"。 */
function foldedDot(tabs: WorkspaceTab[], activeId: string | null) {
  if (tabs.some((tab) => tab.phase === "running" && tab.activity === "awaiting-choice")) return "awaiting";
  if (tabs.some((tab) => tab.id === activeId)) return "active";
  return null;
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

function activityText(activity: Exclude<WorkspaceTab["activity"], "idle">) {
  return { talking: "正在对话", "awaiting-choice": "等待选择" }[activity];
}
