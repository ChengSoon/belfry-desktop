import { formatNumber } from "../../i18n";
import { getLocale, t, useTranslation } from "../../i18n";
import appIconUrl from "../../../src-tauri/icons/32x32.png";
import { ChevronRight, DoorOpen, Download, Gauge, History, PanelLeftClose, Pencil, Server, Settings, Settings2, SquareTerminal, X } from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode, type Ref } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import {
  appShortcutChord,
  formatShortcutChord,
  shortcutPlatform,
} from "../../shortcuts/resolveShortcut";
import type { UpdaterState } from "../../updater/contracts";
import {
  shellProfileLabel,
  type ShellProfile,
  type ShellProfileId,
  type SshLaunch,
} from "../../terminal/contracts";
import { isAgentKind } from "../../agent/contracts";
import type { AgentAvailability, WorkspaceTab, WorkspaceTabKind } from "../contracts";
import { shortPath } from "../path";
import { SIDEBAR_WIDTH } from "../sidebarWidth";
import { groupTabsByProject, type ProjectGroup } from "../tabs";
import { AGENT_ICONS } from "./AgentIcons";
import { NewSessionMenu } from "./NewSessionMenu";
import { SshDialog } from "./SshDialog";
import "../sidebar.css";
import { composingKey } from "../../utils/keyboard";
import "../quietSidebar.css";

interface SidebarProps {
  workspaceControls?: ReactNode;
  agents: AgentAvailability[];
  shellProfiles: ShellProfile[];
  tabs: WorkspaceTab[];
  activeId: string | null;
  /** 正被拖着的会话，拖拽期间在列表里淡下去。 */
  draggingId: string | null;
  foldedProjects: ReadonlySet<string>;
  onLaunch: (kind: WorkspaceTabKind, profileId?: ShellProfileId) => void;
  onLaunchSsh: (target: SshLaunch) => void;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onRefresh: () => Promise<void>;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, customTitle: string | null) => void;
  /** 给 Agent 会话起协作用的唯一名。返回错误信息表示没改成，null 表示成了。 */
  onRenameAgent: (id: string, raw: string) => string | null;
  onDragStart: (id: string, event: PointerEvent) => void;
  /** 拖完那下 pointerup 还会带出一次 click，返回 true 表示这次点击该被吞掉。 */
  onConsumeClick: () => boolean;
  onToggleFold: (projectId: string) => void;
  onCollapse: () => void;
  onToggleUsage: () => void;
  onToggleHistory: () => void;
  onToggleRooms: () => void;
  onOpenUpdater: () => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  usageOpen: boolean;
  historyOpen: boolean;
  roomsOpen: boolean;
  /** 房间里需要你处理的事：成员在等你选择、消息卡住了。0 表示没有。 */
  roomAttention?: number;
  updaterOpen: boolean;
  updaterState: UpdaterState;
  /** 命中测试要拿侧栏的真实矩形，才能判断会话被拖回了列表。 */
  ref?: Ref<HTMLElement>;
  /** 当前拖拽正悬在侧栏上：松手就把这个会话从舞台摘掉。 */
  ejecting?: boolean;
}

export function Sidebar({
  workspaceControls,
  agents,
  shellProfiles,
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
  onRenameAgent,
  onDragStart,
  onConsumeClick,
  onToggleFold,
  onCollapse,
  onToggleUsage,
  onToggleHistory,
  onToggleRooms,
  onOpenUpdater,
  onOpenSettings,
  ref,
  settingsOpen,
  updaterOpen,
  updaterState,
  usageOpen,
  historyOpen,
  roomsOpen,
  roomAttention = 0,
}: SidebarProps) {
  useTranslation();
  const groups = useMemo(() => groupTabsByProject(tabs), [tabs, getLocale()]);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(SIDEBAR_WIDTH);
  const sidebarStyle = { "--sidebar-width": `${width}px` } as CSSProperties;
  const platform = shortcutPlatform(document.documentElement.dataset.platform);

  return (
    <aside
      className={`sidebar${ejecting ? " is-eject-target" : ""}`}
      aria-label={t("workspace.Sidebar.text_a63280253f")}
      ref={ref}
      style={sidebarStyle}
    >
      <div className="sidebar-sessions">
        <div>
          <div className="sidebar-brand"><img src={appIconUrl} alt="" aria-hidden="true" />
            <div><strong>Belfry</strong><span>{t("workspace.Sidebar.text_45f2d72cba")}</span></div>
          </div>
          <div className="sidebar-context">
            {workspaceControls}
            <button className="icon-button icon-button--sm sidebar-context__collapse" onClick={onCollapse}
              aria-label={t("workspace.Sidebar.text_bb0b6e36b3")} title={t("workspace.Sidebar.text_78a77f7d72", { shortcut: formatShortcutChord(appShortcutChord(platform, "B")) })} type="button">
              <PanelLeftClose aria-hidden="true" size={ICON.sm} />
            </button>
          </div>
          <div className="sessions-head">
            <span>{t("workspace.Sidebar.sessionCount", { count: tabs.length })}</span>
            <NewSessionMenu
              agents={agents}
              shellProfiles={shellProfiles}
              onLaunch={onLaunch}
              onLaunchSsh={onLaunchSsh}
              onRefresh={onRefresh}
              shellShortcut={formatShortcutChord(appShortcutChord(platform, "T"))}
            />
          </div>
        </div>
        <nav className="session-list" aria-label={t("workspace.Sidebar.text_c980de330f")}>
          {groups.map((group) => (
            <SessionGroup
              activeId={activeId}
              draggingId={draggingId}
              folded={groups.length > 1 && foldedProjects.has(group.project.id)}
              showHeading={groups.length > 1}
              group={group}
              key={group.project.id}
              onActivate={onActivate}
              onClose={onClose}
              onRename={onRename}
              onRenameAgent={onRenameAgent}
              onUpdateSsh={onUpdateSsh}
              onConsumeClick={onConsumeClick}
              onDragStart={onDragStart}
              onToggleFold={onToggleFold}
            />
          ))}
        </nav>
      </div>

      <div className="sidebar-foot">
        <span className="sidebar-foot__label">{t("workspace.Sidebar.text_5ca6730d44")}</span>
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
            aria-label={roomAttention ? t("workspace.Sidebar.text_af7524d31d", { roomAttention: roomAttention }) : t("workspace.Sidebar.text_63235691ff")}
            aria-pressed={roomsOpen}
            className={`icon-button icon-button--sm room-trigger${roomAttention ? " room-trigger--attention" : ""}`}
            onClick={onToggleRooms}
            title={roomAttention ? t("workspace.Sidebar.text_f9bb3d275b", { roomAttention: roomAttention }) : t("workspace.Sidebar.text_63235691ff")}
            type="button"
          >
            <DoorOpen aria-hidden="true" size={ICON.md} />
            <span>{t("workspace.Sidebar.text_63235691ff")}</span>
            {roomAttention ? <b className="room-trigger__count">{roomAttention}</b> : null}
          </button>
          <button
            aria-pressed={settingsOpen}
            className="icon-button icon-button--sm"
            onClick={onOpenSettings}
            title={t("workspace.Sidebar.text_cb216cffd3", { shortcut: formatShortcutChord(appShortcutChord(platform, ",")) })}
            type="button"
          >
            <Settings aria-hidden="true" size={ICON.md} />
            <span>{t("workspace.Sidebar.text_df3d58c7d8")}</span>
          </button>
          <button
            aria-pressed={usageOpen}
            className="icon-button icon-button--sm"
            onClick={onToggleUsage}
            title={t("workspace.Sidebar.text_09d2dbc1d3", { shortcut: formatShortcutChord(appShortcutChord(platform, "U")) })}
            type="button"
          >
            <Gauge aria-hidden="true" size={ICON.md} />
            <span>{t("workspace.Sidebar.text_42723e8b49")}</span>
          </button>
          <button
            aria-pressed={historyOpen}
            className="icon-button icon-button--sm"
            onClick={onToggleHistory}
            title={t("workspace.Sidebar.text_f6fe0f8c08", { shortcut: formatShortcutChord(appShortcutChord(platform, "H", true)) })}
            type="button"
          >
            <History aria-hidden="true" size={ICON.md} />
            <span>{t("workspace.Sidebar.text_0eccd0db7b")}</span>
          </button>
        </div>
      </div>
      <PanelResizeHandle
        label={t("workspace.Sidebar.text_8d69ed54cd")}
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
  if (state.status === "available") return t("workspace.Sidebar.text_ff9876fc72", { availableVersion: state.availableVersion });
  if (state.status === "downloading" || state.status === "installing") return t("workspace.Sidebar.text_0527331ad6");
  if (state.status === "checking") return t("workspace.Sidebar.text_0d47abe618");
  if (state.status === "error") return t("workspace.Sidebar.text_7cc3341927");
  return t("workspace.Sidebar.text_7f68ebad19");
}

function SessionGroup({
  group,
  folded,
  showHeading,
  activeId,
  draggingId,
  onActivate,
  onClose,
  onRename,
  onRenameAgent,
  onUpdateSsh,
  onConsumeClick,
  onDragStart,
  onToggleFold,
}: {
  group: ProjectGroup;
  folded: boolean;
  showHeading: boolean;
  activeId: string | null;
  draggingId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onRename: (id: string, customTitle: string | null) => void;
  /** 给 Agent 会话起协作用的唯一名。返回错误信息表示没改成，null 表示成了。 */
  onRenameAgent: (id: string, raw: string) => string | null;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onConsumeClick: () => boolean;
  onDragStart: (id: string, event: PointerEvent) => void;
  onToggleFold: (projectId: string) => void;
}) {
  useTranslation();
  const rowsId = useId();
  // 折叠时组里的会话全藏起来了，标题上留个点，不然看不出这组里有正在跑的东西。
  const dot = folded ? foldedDot(group.tabs, activeId) : null;

  return (
    <div className={`session-group${folded ? " is-folded" : ""}`}>
      {showHeading ? <button
        aria-expanded={!folded}
        aria-controls={rowsId}
        aria-label={t(dot === "awaiting" ? "workspace.Sidebar.sessionGroupWaiting" : "workspace.Sidebar.sessionGroup", { name: group.project.name, count: group.tabs.length })}
        className="session-group__head"
        onClick={() => onToggleFold(group.project.id)}
        title={group.project.rootPath ? shortPath(group.project.rootPath) : t("workspace.Sidebar.text_b07b857f21")}
        type="button"
      >
        <ChevronRight aria-hidden="true" className="session-group__chevron" size={ICON.xs} />
        {group.project.id === "ssh" ? <Server aria-hidden="true" size={ICON.xs} /> : null}
        <span>{group.project.name}</span>
        {folded ? <i className="session-group__count" aria-hidden="true">{formatNumber(group.tabs.length)}</i> : null}
        {dot ? <i className={`session-group__dot session-group__dot--${dot}`} aria-hidden="true" /> : null}
      </button> : null}
      <div className="session-group__collapse" inert={folded} aria-hidden={folded} id={rowsId}>
        <div className="session-group__rows">
      {group.tabs.map((tab) => (
        <SessionRow
          active={tab.id === activeId}
          dragging={tab.id === draggingId}
          key={tab.id}
          onActivate={onActivate}
          onClose={onClose}
          onRename={onRename}
          onRenameAgent={onRenameAgent}
          onUpdateSsh={onUpdateSsh}
          onConsumeClick={onConsumeClick}
          onDragStart={onDragStart}
          tab={tab}
        />
      ))}
        </div>
      </div>
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
  onRenameAgent,
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
  /** 给 Agent 会话起协作用的唯一名。返回错误信息表示没改成，null 表示成了。 */
  onRenameAgent: (id: string, raw: string) => string | null;
  onUpdateSsh: (id: string, target: SshLaunch) => void;
  onConsumeClick: () => boolean;
  onDragStart: (id: string, event: PointerEvent) => void;
}) {
  useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [sshEditorOpen, setSshEditorOpen] = useState(false);
  const sshEditRef = useRef<HTMLButtonElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const restoreAfterEdit = useRef(false);
  const nameErrorId = useId();
  useLayoutEffect(() => {
    if (!editing && restoreAfterEdit.current) {
      restoreAfterEdit.current = false;
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);
  // Escape 取消后 input 卸载会补发一次 blur，不挡一下会把"取消"变成"提交"。
  const dismissed = useRef(false);
  const Icon = tab.kind === "shell" ? SquareTerminal : isAgentKind(tab.kind) ? AGENT_ICONS[tab.kind] : Server;
  // 两种会话都能改名，但改的是两样东西：SSH 改显示标题，Agent 改协作里的寻址名。
  const renamesAgent = isAgentKind(tab.kind);
  const renamable = renamesAgent || tab.kind === "ssh";
  const startEditing = () => {
    dismissed.current = false;
    setNameError(null);
    setDraft(renamesAgent ? tab.agentName ?? "" : tab.title);
    setEditing(true);
  };
  const commit = (restoreFocus = false) => {
    if (dismissed.current) return;
    if (renamesAgent) {
      const error = onRenameAgent(tab.id, draft);
      // 名字不合规就留在编辑态，把理由摆出来——关掉输入框再报错，
      // 用户得重新点开才能改，而且不知道刚才哪儿写错了。
      if (error) {
        setNameError(error);
        return;
      }
    } else {
      onRename(tab.id, draft.trim() || null);
    }
    restoreAfterEdit.current = restoreFocus;
    dismissed.current = true;
    setNameError(null);
    setEditing(false);
  };
  const cancel = () => {
    restoreAfterEdit.current = true;
    dismissed.current = true;
    setNameError(null);
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
      <div className={`session-row${active ? " is-active" : ""}${dim ? " is-dim" : ""}${dragging ? " is-dragging" : ""}${tab.kind === "ssh" ? " session-row--ssh" : ""}${renamesAgent ? " session-row--agent" : ""}`} data-tab-id={tab.id}>
      {editing ? (
        <div className="session-row__main session-row__main--editing">
          <Icon aria-hidden="true" size={ICON.sm} />
          <input
            aria-invalid={nameError !== null}
            aria-describedby={nameError ? nameErrorId : undefined}
            aria-label={renamesAgent ? t("workspace.Sidebar.text_6afb61059b") : t("workspace.Sidebar.text_dc5692f72f")}
            autoFocus
            maxLength={renamesAgent ? 32 : 64}
            onChange={(event) => {
              setDraft(event.target.value);
              // 一边打字一边把上次的红消掉，否则改对了还挂着旧理由。
              if (nameError) setNameError(null);
            }}
            onBlur={() => commit()}
            onKeyDown={(event) => {
              // 中文 / 日文输入法按 Enter 是「确认候选词」，不是「提交」。不放过这一下的话，
              // 用中文起名时存进去的是拼音（shencha），编辑框还当场关掉——用户以为没保存成功，
              // 其实存了个莫名的英文名。Escape 同理：组字时那是「取消候选」，不该连框一起关。
              if (composingKey(event.nativeEvent)) return;
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commit(true);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancel();
              }
            }}
            onPointerDown={(event) => event.stopPropagation()}
            placeholder={renamesAgent ? t("workspace.Sidebar.text_eb0fc9038d") : undefined}
            title={nameError ?? undefined}
            value={draft}
          />
        </div>
      ) : (
        <button
          aria-current={active}
          aria-label={t("workspace.Sidebar.sessionStatus", { name: sessionLabel(tab), status: statusText(tab) })}
          className="session-row__main"
          // 拖到终端上分屏；没拖动就是普通的切换点击。
          onClick={() => {
            if (!onConsumeClick()) onActivate(tab.id);
          }}
          onDoubleClick={renamable ? startEditing : undefined}
          onPointerDown={(event) => onDragStart(tab.id, event)}
          onKeyDown={(event) => {
            if (renamable && event.key === "F2") { event.preventDefault(); startEditing(); }
          }}
          ref={mainRef}
          title={rowTitle(tab)}
          type="button"
        >
          <Icon aria-hidden="true" size={ICON.sm} />
          <span>{sessionLabel(tab)}</span>
        </button>
      )}
      <div className={`session-row__tail${tab.kind === "ssh" ? " session-row__tail--wide" : renamesAgent ? " session-row__tail--rename" : ""}`}>
        {tab.kind === "ssh" ? (
          <button
            aria-label={t("workspace.Sidebar.text_c49d0350ec")}
            className="session-row__edit"
            onClick={openSshEditor}
            ref={sshEditRef}
            title={t("workspace.Sidebar.text_c49d0350ec")}
            type="button"
          >
            <Settings2 aria-hidden="true" size={ICON.xs} />
          </button>
        ) : null}
        {renamable ? (
          <button
            aria-label={renamesAgent ? t("workspace.Sidebar.text_474a5fb084") : t("workspace.Sidebar.text_5f64610f9f")}
            className="session-row__rename"
            onClick={startEditing}
            title={renamesAgent
              ? tab.agentName ? t("workspace.Sidebar.renameNamedAgent", { name: tab.agentName }) : t("workspace.Sidebar.renameAgent")
              : t("workspace.Sidebar.text_5f64610f9f")}
            type="button"
          >
            <Pencil aria-hidden="true" size={ICON.xs} />
          </button>
        ) : null}
        <SessionDot tab={tab} />
        <button
          className="session-row__close"
          onClick={() => onClose(tab.id)}
          title={t("workspace.Sidebar.text_24974f5c14", { name: sessionLabel(tab) })}
          type="button"
        >
          <X aria-hidden="true" size={ICON.xs} />
        </button>
      </div>
      </div>
      {nameError ? <span className="session-row__name-error" id={nameErrorId} role="alert">{nameError}</span> : null}
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
/**
 * 侧栏这一行显示什么。
 *
 * 起了协作名字就显示名字：那是用户自己给的稳定叫法，也正是别的 Agent 派活时要
 * 写的东西。没起名字才回落到自动标题——它是从最后一条输入生成的，每敲一条就变。
 */
function sessionLabel(tab: WorkspaceTab) {
  return tab.agentName ?? tab.title;
}

function rowTitle(tab: WorkspaceTab) {
  if (tab.error) return tab.error;
  if (tab.kind === "shell") return shellProfileLabel(tab.profileId as ShellProfileId);
  if (tab.kind === "ssh") return t("workspace.Sidebar.text_179d788534", { title: tab.title });
  const detail = tab.titleHint ?? tab.title;
  // 起过名字的行显示的是名字，正在干什么就只剩 tooltip 能交代了。
  return tab.agentName ? `${tab.agentName} · ${detail}` : t("workspace.Sidebar.text_8fd4074e0b", { detail: detail });
}

/**
 * 一条会话最多一个点：进程不正常时报 phase，正常跑着时报它在干什么。
 * 跑得好好的又没在忙就不显示——列表安静下来，剩下的点才有分量。
 * exited 同样不显示：整行已经褪成灰的了（.is-dim），再点一个灰点是同一件事说两遍。
 */
function SessionDot({ tab }: { tab: WorkspaceTab }) {
  useTranslation();
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
    idle: t("workspace.Sidebar.text_dae661d17c"),
    creating: t("workspace.Sidebar.text_33439d2631"),
    running: t("workspace.Sidebar.text_1f0eb99b7e"),
    exited: t("workspace.Sidebar.text_899df7e244"),
    error: t("workspace.Sidebar.text_0bc1fb72ae"),
  }[phase];
}

function activityText(activity: Exclude<WorkspaceTab["activity"], "idle">) {
  return { talking: t("workspace.Sidebar.text_df25f3c3f0"), "awaiting-choice": t("workspace.Sidebar.text_c634a6dafd") }[activity];
}
