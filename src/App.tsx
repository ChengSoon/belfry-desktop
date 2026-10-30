import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppBackground } from "./background/AppBackground";
import { AppOverlays } from "./components/AppOverlays";
import { Workbench } from "./components/Workbench";
import { Presence } from "./components/motion/Presence";
import { ProjectInspector } from "./git/ProjectInspector";
import { GitReviewProvider } from "./git/review/GitReviewProvider";
import { projectRelativePath } from "./filepreview/path";
import { WindowTitlebar } from "./components/WindowTitlebar";
import "./workspace/workspace.css";
import { useSessionDrag } from "./layout/useSessionDrag";
import { useSplitLayout } from "./layout/useSplitLayout";
import { useActivityNotifications } from "./notify/useActivityNotifications";
import type { PromptSubmitResult } from "./prompt/contracts";
import { usePromptQueue } from "./prompt/usePromptQueue";
import { appShortcutChord, formatShortcutChord } from "./shortcuts/resolveShortcut";
import { useAppShortcuts } from "./shortcuts/useAppShortcuts";
import { useAppUpdater } from "./updater/useAppUpdater";
import { agentResetCommand, isAgentKind, type AgentKind } from "./agent/contracts";
import type { HistorySession } from "./history/contracts";
import type { QuickOpenItem } from "./quickopen/model";
import { useQuickOpen } from "./quickopen/useQuickOpen";
import type { ShellProfileId, SshLaunch } from "./terminal/contracts";
import { useTerminalTargets } from "./terminal/useTerminalTargets";
import { needsCloseConfirm } from "./workspace/closeConfirm";
import { Sidebar } from "./workspace/components/Sidebar";
import type { RecentProject } from "./workspace/contracts";
import { pathKey } from "./workspace/path";
import { toAppFailure } from "./workspace/errors";
import { groupTabsByProject } from "./workspace/tabs";
import { useFoldedProjects } from "./workspace/useFoldedProjects";
import { useProjectWorkspace } from "./workspace/useProjectWorkspace";
import { NamedWorkspaceControls } from "./workspace/named/NamedWorkspaceControls";
import { useSessionRoster } from "./collab/useSessionRoster";
import { useTaskDelivery } from "./collab/useTaskDelivery";
import { useRoomNotifications } from "./rooms/useRoomNotifications";
import { roomOpenWindow } from "./rooms/api";
import { useRoomBoundTabs } from "./rooms/useRoomBoundTabs";
import { resolveAgentRename } from "./collab/naming";
import { CollabPanel } from "./collab/CollabPanel";
import { useCollabTasks } from "./collab/useCollabTasks";
import { awaitingApproval } from "./collab/taskTone";
import { PluginRuntimeBridge } from "./plugins/PluginRuntimeBridge";
import { PluginDock } from "./plugins/workspace/PluginDock";
import { usePluginWorkspace } from "./plugins/workspace/usePluginWorkspace";

interface PreviewRequest {
  path: string;
  line: number | null;
}

export default function App() {
  const workspace = useProjectWorkspace();
  const { foldedProjects, toggleFold, unfold } = useFoldedProjects();
  const [collapsed, setCollapsed] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [collabOpen, setCollabOpen] = useState(false);
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pluginDockOpen, setPluginDockOpen] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RecentProject | null>(null);
  const updater = useAppUpdater();
  const stageRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const layout = useSplitLayout({ tabs: workspace.visibleTabs, activeTabId: workspace.activeTabId,
    setActiveTabId: workspace.setActiveTabId, root: workspace.named.current.layout, onChange: workspace.named.setLayout });
  const { drag, startDrag, consumedClick } = useSessionDrag(stageRef, sidebarRef, layout.panes, {
    onDrop: layout.dropTab,
    onEject: layout.closePane,
    // 只有分屏里的会话摘得动：没分屏时舞台始终跟着活动会话，摘掉也没地方去。
    canEject: (tabId) => layout.panes.length > 1 && layout.rects.has(tabId),
  });

  // 画在舞台上的那几条会话。没分屏时就是活动会话自己；用户看得见的就不必再弹通知。
  const visibleTabIds = useMemo(() => new Set(layout.rects.keys()), [layout.rects]);
  useActivityNotifications(workspace.tabs, visibleTabIds);

  // 新会话继承 activeProject，那组要是折叠着就会开出一个侧栏里看不见的会话。
  const launch = useCallback((
    kind: Parameters<typeof workspace.launch>[0],
    profileId?: ShellProfileId,
  ) => {
    if (workspace.activeProject) unfold(workspace.activeProject.id);
    void workspace.launch(kind, profileId);
  }, [unfold, workspace.activeProject, workspace.launch]);

  const launchSsh = useCallback((target: SshLaunch) => {
    unfold("ssh");
    void workspace.launchSsh(target);
  }, [unfold, workspace.launchSsh]);

  const resumeHistory = useCallback((session: HistorySession) => {
    if (workspace.activeProject) unfold(workspace.activeProject.id);
    void workspace.launchHistorySession(session);
  }, [unfold, workspace.launchHistorySession, workspace.activeProject]);

  // 房间成员会话只在房间里露面：侧栏、Quick Open 与 ⌘1-9 都按过滤后的列表走；
  // 投递、协作名册与持久化仍拿全量 tabs——隔离只做在展示层。
  const roomBound = useRoomBoundTabs();
  const listedTabs = useMemo(
    () => workspace.visibleTabs.filter((tab) => !roomBound.boundIds.has(tab.id)),
    [workspace.visibleTabs, roomBound.boundIds],
  );
  const quickOpenTabs = useMemo(
    () => workspace.tabs.filter((tab) => !roomBound.boundIds.has(tab.id)),
    [workspace.tabs, roomBound.boundIds],
  );

  const quickOpen = useQuickOpen({
    activateTab: layout.activateTab,
    activeTabId: workspace.activeTabId,
    recentProjects: workspace.recentProjects,
    selectProject: workspace.selectProject,
    tabs: quickOpenTabs,
  });
  const terminalTargets = useTerminalTargets();
  // 控制 CLI 从 PTY 里连进来问「现在有谁在」时前端不在调用栈上，得先把名册推过去。
  useSessionRoster(workspace.tabs);
  /**
   * 给 Agent 会话起协作名字：校验通过就落库，不通过把理由交回侧栏当场显示。
   *
   * 校验放在这里而不是 workspace 里，是因为唯一性要看全部会话，而理由必须能
   * 同步回到那个输入框——塞进 setState 回调里就只能默默丢掉。
   */
  const renameAgent = useCallback((id: string, raw: string) => {
    const outcome = resolveAgentRename(raw, workspace.tabs, id);
    if ("error" in outcome) return outcome.error;
    workspace.renameAgent(id, outcome.name);
    return null;
  }, [workspace.renameAgent, workspace.tabs]);
  // 房间成员用协作模式启动（总线只认 Codex/Claude 两个配置）；不抢当前焦点，切回去看房间。
  const launchRoomMember = useCallback(async (kind: AgentKind, projectRoot: string) => {
    if (workspace.activeProject && pathKey(workspace.activeProject.rootPath) === pathKey(projectRoot)) {
      unfold(workspace.activeProject.id);
    }
    return workspace.launch(kind, undefined, projectRoot, false, kind === "codex" || kind === "claude");
  }, [unfold, workspace.activeProject, workspace.launch]);
  const promptQueue = usePromptQueue({ tabs: workspace.tabs, targets: terminalTargets.targets });
  // `belfry send` 的任务经后台队列投进目标终端，等待目标 Agent 空闲。
  useTaskDelivery(promptQueue.submit);

  // 房间成员的「清除上下文」：把该 Agent 自己的重置命令经同一条 Prompt 队列送进它的
  // 终端——忙时排队、等它空闲再送出；进程、会话与房间身份都不动，也不移出成员。
  const clearRoomMemberContext = useCallback((tabId: string): PromptSubmitResult => {
    const tab = workspace.tabs.find((candidate) => candidate.id === tabId);
    if (!tab || !isAgentKind(tab.kind)) return "unavailable";
    const command = agentResetCommand(tab.kind);
    if (!command) return "unavailable";
    return promptQueue.submit(tabId, command);
  }, [promptQueue.submit, workspace.tabs]);
  // 房间任务的「已提交待验证」提醒：轮询挂在 App 层，房间视图不开也照常工作。
  useRoomNotifications(roomsOpen);
  const collab = useCollabTasks();
  // 历史会话与用量面板互斥：两者都占右侧一列，栅格只留了一条轨道。
  const toggleUsage = useCallback(() => {
    setPluginDockOpen(false);
    setHistoryOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setCollabOpen(false);
    setRoomsOpen(false);
    setUsageOpen((value) => !value);
  }, []);

  const toggleHistory = useCallback(() => {
    setPluginDockOpen(false);
    setUsageOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setCollabOpen(false);
    setRoomsOpen(false);
    setHistoryOpen((value) => !value);
  }, []);

  const toggleQuickOpen = useCallback(() => {
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setRoomsOpen(false);
    quickOpen.toggle();
  }, [quickOpen.toggle]);

  const toggleCollab = useCallback(() => {
    setPluginDockOpen(false);
    quickOpen.close();
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setRoomsOpen(false);
    setCollabOpen((value) => !value);
  }, [quickOpen.close]);

  const toggleRooms = useCallback(() => {
    setPluginDockOpen(false);
    quickOpen.close();
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setRoomsOpen((value) => !value);
  }, [quickOpen.close]);

  const openPreview = useCallback((request?: PreviewRequest) => {
    setPluginDockOpen(false);
    quickOpen.close();
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setRoomsOpen(false);
    setPreviewOpen(true);
    setPreviewRequest(request ?? null);
  }, [quickOpen.close]);

  // 回执里的文件路径：先收房间再开预览——预览占右侧整窗，和房间互斥。
  const openRoomFile = useCallback((relativePath: string) => {
    setRoomsOpen(false);
    openPreview({ path: relativePath, line: null });
  }, [openPreview]);

  // 在新窗口打开一间房。失败原因原样交回房间视图的提示栏——开窗失败大多是
  // 系统窗口配额，偶发一次，不值得升级成全局错误条。
  const openRoomWindow = useCallback(async (roomId: string, roomName: string) => {
    try {
      await roomOpenWindow(roomId, roomName);
      return null;
    } catch (cause) {
      return toAppFailure(cause).message;
    }
  }, []);

  const revealPluginDock = useCallback(() => {
    setSettingsOpen(false); setUsageOpen(false); setHistoryOpen(false);
    setPreviewOpen(false); setCollabOpen(false); setRoomsOpen(false); setPluginDockOpen(true);
  }, []);
  const togglePluginDock = useCallback(() => {
    setUsageOpen(false); setHistoryOpen(false); setPreviewOpen(false); setCollabOpen(false);
    setRoomsOpen(false);
    setPluginDockOpen((value) => !value);
  }, []);
  const openPluginProject = useCallback(async (path: string) => {
    await workspace.selectProject(path); setSettingsOpen(false);
  }, [workspace.selectProject]);
  usePluginWorkspace({ openProject: openPluginProject, reveal: revealPluginDock, toggle: togglePluginDock });

  const togglePreview = useCallback(() => {
    if (previewOpen) {
      setPreviewOpen(false);
      setPreviewRequest(null);
      return;
    }
    openPreview();
  }, [openPreview, previewOpen]);

  const openTerminalFile = useCallback((tabId: string, candidate: string, line: number | null) => {
    const tab = workspace.tabs.find((item) => item.id === tabId);
    if (!tab || tab.kind === "ssh") return;
    const relativePath = projectRelativePath(tab.project.rootPath, candidate);
    if (!relativePath) return;
    openPreview({ path: relativePath, line });
  }, [openPreview, workspace.tabs]);

  /**
   * 侧栏那个 X 是真删会话：PTY 被杀，滚屏跟着没，撤不回来。进程还活着就先拦一道，
   * 已经退出/出错的直接关。分屏窗格上的 X 走的是 layout.closePane（只把窗格
   * 移出分屏，会话照旧活着），不经过这里，也不该弹框。
   */
  const requestClose = useCallback((id: string) => {
    const tab = workspace.tabs.find((item) => item.id === id);
    if (tab && needsCloseConfirm(tab)) setPendingCloseId(id);
    else workspace.closeTab(id);
  }, [workspace.closeTab, workspace.tabs]);

  const confirmClose = useCallback(() => {
    if (pendingCloseId) workspace.closeTab(pendingCloseId);
    setPendingCloseId(null);
  }, [pendingCloseId, workspace.closeTab]);

  const cancelClose = useCallback(() => setPendingCloseId(null), []);

  // 查一次而不是把 tab 存进 state：弹框开着时这条会话可能已经被别处关掉，
  // 查不到就自然不渲染，也不会拿着一份过期的 phase 去写文案。
  const pendingClose = workspace.tabs.find((tab) => tab.id === pendingCloseId) ?? null;
  const shortcuts = useAppShortcuts({
    blocked: Boolean(pendingClose || pendingRemove || updater.open),
    quickOpenOpen: quickOpen.open,
    onActivateSession: (index) => {
      const tab = groupTabsByProject(listedTabs).flatMap((group) => group.tabs)[index];
      if (tab) layout.activateTab(tab.id);
    },
    onNewShell: () => launch("shell"),
    onOpenSettings: () => { setSettingsSection(undefined); setSettingsOpen(true); },
    onToggleHistory: toggleHistory,
    onToggleQuickOpen: toggleQuickOpen,
    onToggleSidebar: () => setCollapsed((value) => !value),
    onToggleUsage: toggleUsage,
  });

  const selectQuickOpenItem = useCallback((item: QuickOpenItem) => {
    quickOpen.select(item, (id) => {
      switch (id) {
        case "action:new-shell": launch("shell"); break;
        case "action:collab": toggleCollab(); break;
        case "action:room": toggleRooms(); break;
        case "action:file-preview": openPreview(); break;
        case "action:settings": setSettingsSection(undefined); setSettingsOpen(true); break;
        case "action:about": setSettingsSection("about"); setSettingsOpen(true); break;
        case "action:history": toggleHistory(); break;
        case "action:usage": toggleUsage(); break;
        case "action:sidebar": setCollapsed((value) => !value); break;
        case "action:shortcuts": shortcuts.openGuide(); break;
        default: break;
      }
    });
  }, [launch, openPreview, quickOpen, shortcuts, toggleCollab, toggleHistory, toggleRooms, toggleUsage]);

  return (
    <main
      className={`app-shell${collapsed ? " is-collapsed" : ""}${usageOpen ? " has-usage" : ""}${historyOpen ? " has-history" : ""}${previewOpen ? " has-preview" : ""}${roomsOpen ? " is-rooms" : ""}${settingsOpen ? " is-settings" : ""}${collabOpen ? " has-collab" : ""}${pluginDockOpen ? " has-plugin-dock" : ""}`}
    >
      <AppBackground />
      <WindowTitlebar />
      <PluginRuntimeBridge workspacePath={workspace.activeProject?.rootPath} sessionId={workspace.activeTabId} />

      <div className={`sidebar-shell${collapsed ? " is-collapsed" : ""}`} inert={collapsed} aria-hidden={collapsed}>
        <Sidebar
          workspaceControls={<NamedWorkspaceControls model={workspace.named}
            activeTab={workspace.tabs.find((tab) => tab.id === workspace.activeTabId) ?? null}
            onRepair={workspace.repairProject} persistenceError={workspace.persistenceError}
            onRetryPersistence={workspace.retryPersistence} />}
          activeId={workspace.activeTabId}
          agents={workspace.agents}
          shellProfiles={workspace.shellProfiles}
          draggingId={drag?.tabId ?? null}
          ejecting={drag?.target?.kind === "sidebar"}
          foldedProjects={foldedProjects}
          onActivate={layout.activateTab}
          onClose={requestClose}
          onRename={workspace.renameTab}
          onRenameAgent={renameAgent}
          onCollapse={() => setCollapsed(true)}
          onConsumeClick={consumedClick}
          onDragStart={startDrag}
          onLaunch={launch}
          onLaunchSsh={launchSsh}
          onRefresh={workspace.redetectAgents}
          onUpdateSsh={workspace.updateSsh}
          onToggleFold={toggleFold}
          onToggleUsage={toggleUsage}
          onToggleHistory={toggleHistory}
          roomsOpen={roomsOpen}
          onToggleRooms={toggleRooms}
          historyOpen={historyOpen}
          onOpenUpdater={updater.openPanel}
          onOpenSettings={() => { setSettingsSection(undefined); setSettingsOpen(true); }}
          settingsOpen={settingsOpen}
          ref={collapsed ? undefined : sidebarRef}
          tabs={listedTabs}
          updaterOpen={updater.open}
          updaterState={updater.state}
          usageOpen={usageOpen}
        />
      </div>

      <Workbench
        activeProject={workspace.activeProject}
        activeTabId={workspace.activeTabId}
        collapsed={collapsed}
        collabOpen={collabOpen}
        collabWaiting={awaitingApproval(collab.tasks).length}
        dividers={layout.dividers}
        drag={drag}
        onClosePane={layout.closePane}
        onDragStart={startDrag}
        onFocus={workspace.setActiveTabId}
        onLaunchShell={() => launch("shell")}
        onOpenProject={workspace.selectProject}
        onOpenShortcutGuide={shortcuts.openGuide}
        onRegisterTarget={terminalTargets.register}
        onOpenFile={openTerminalFile}
        onRequestRemove={setPendingRemove}
        onResize={layout.resizeSplit}
        onRevealSidebar={() => setCollapsed(false)}
        onSnapshot={workspace.updateTab}
        onToggleCollab={toggleCollab}
        onTogglePreview={togglePreview}
        onToggleQuickOpen={toggleQuickOpen}
        opening={workspace.opening}
        previewOpen={previewOpen}
        pluginDockOpen={pluginDockOpen}
        quickOpenOpen={quickOpen.open}
        recentProjects={workspace.recentProjects}
        rects={layout.rects}
        shortcutGuideOpen={shortcuts.guideOpen}
        shortcutPlatform={shortcuts.platform}
        split={layout.split}
        stageRef={stageRef}
        tabs={workspace.tabs}
      />

      <Presence open={collabOpen} drawer><CollabPanel collab={collab} onClose={() => setCollabOpen(false)} /></Presence>
      <PluginDock visible={pluginDockOpen && !settingsOpen} onClose={() => setPluginDockOpen(false)} />

      <GitReviewProvider tabs={workspace.visibleTabs} activeTabId={workspace.activeTabId}
        submit={promptQueue.submit} cancel={promptQueue.cancel} onActivate={layout.activateTab}>
      {previewOpen ? (
        <ProjectInspector
          onOpenProject={workspace.selectProject}
          onClose={() => {
            setPreviewOpen(false);
            setPreviewRequest(null);
          }}
          project={workspace.activeProject}
          requestedLine={previewRequest?.line ?? null}
          requestedPath={previewRequest?.path ?? null}
        />
      ) : null}
      </GitReviewProvider>

      <AppOverlays
        agents={workspace.agents}
        failure={workspace.failure}
        historyOpen={historyOpen}
        onCancelClose={cancelClose}
        onCancelRemove={() => setPendingRemove(null)}
        onCheckUpdate={updater.checkNow}
        onCloseHistory={() => setHistoryOpen(false)}
        onCloseQuickOpen={quickOpen.close}
        onCloseRoomMember={workspace.closeTab}
        onClearRoomMemberContext={clearRoomMemberContext}
        onCloseRooms={() => { setRoomsOpen(false); void roomBound.refresh(); }}
        onCloseSettings={() => setSettingsOpen(false)}
        onOpenUpdater={updater.openPanel}
        onCloseShortcutGuide={shortcuts.closeGuide}
        onCloseUpdater={updater.closePanel}
        onCloseUsage={() => setUsageOpen(false)}
        onConfirmClose={confirmClose}
        onConfirmRemove={() => {
          if (pendingRemove) workspace.removeRecentProject(pendingRemove.id);
          setPendingRemove(null);
        }}
        onDismissFailure={workspace.dismissFailure}
        onInstallUpdate={updater.install}
        onOpenRoomFile={openRoomFile}
        onOpenRoomWindow={openRoomWindow}
        onLaunchRoomMember={launchRoomMember}
        onRenameAgent={renameAgent}
        onResumeHistory={resumeHistory}
        onSelectQuickOpen={selectQuickOpenItem}
        pendingClose={pendingClose}
        pendingRemove={pendingRemove}
        pendingRemoveTabCount={pendingRemove ? workspace.tabs.filter(
          (tab) => pathKey(tab.project.rootPath) === pathKey(pendingRemove.rootPath),
        ).length : 0}
        project={workspace.activeProject}
        quickOpenItems={quickOpen.items}
        quickOpenOpen={quickOpen.open}
        quickOpenShortcut={formatShortcutChord(appShortcutChord(shortcuts.platform, "K"))}
        roomsOpen={roomsOpen}
        settingsOpen={settingsOpen}
        settingsSection={settingsSection}
        shortcutGuideOpen={shortcuts.guideOpen}
        shortcutPlatform={shortcuts.platform}
        tabs={workspace.tabs}
        updaterOpen={updater.open}
        updaterState={updater.state}
        usageOpen={usageOpen}
      />
    </main>
  );
}
