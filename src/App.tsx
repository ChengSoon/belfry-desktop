import { useCallback, useMemo, useRef, useState } from "react";
import { AppBackground } from "./background/AppBackground";
import { AppOverlays } from "./components/AppOverlays";
import { Workbench } from "./components/Workbench";
import { FilePreviewPane } from "./filepreview/FilePreviewPane";
import { projectRelativePath } from "./filepreview/path";
import { WindowTitlebar } from "./components/WindowTitlebar";
import "./workspace/workspace.css";
import { useSessionDrag } from "./layout/useSessionDrag";
import { useSplitLayout } from "./layout/useSplitLayout";
import { useActivityNotifications } from "./notify/useActivityNotifications";
import { useSharedContext } from "./collab/useSharedContext";
import { useCollabSessions } from "./collab/useCollabSessions";
import { useCollabTasks } from "./collab/useCollabTasks";
import { useCollabTaskBoard } from "./collab/useCollabTaskBoard";
import { contextReference, type ContextItem } from "./collab/contracts";
import { usePromptQueue } from "./prompt/usePromptQueue";
import { useRecipes } from "./recipe/useRecipes";
import { appShortcutChord, formatShortcutChord } from "./shortcuts/resolveShortcut";
import { useAppShortcuts } from "./shortcuts/useAppShortcuts";
import { useAppUpdater } from "./updater/useAppUpdater";
import type { HistorySession } from "./history/contracts";
import type { QuickOpenItem } from "./quickopen/model";
import { useQuickOpen } from "./quickopen/useQuickOpen";
import type { ShellProfileId, SshLaunch } from "./terminal/contracts";
import { useTerminalTargets } from "./terminal/useTerminalTargets";
import { needsCloseConfirm } from "./workspace/closeConfirm";
import { Sidebar } from "./workspace/components/Sidebar";
import type { RecentProject } from "./workspace/contracts";
import { pathKey } from "./workspace/path";
import { groupTabsByProject } from "./workspace/tabs";
import { useFoldedProjects } from "./workspace/useFoldedProjects";
import { useProjectWorkspace } from "./workspace/useProjectWorkspace";

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
  const [composerOpen, setComposerOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRequest, setPreviewRequest] = useState<PreviewRequest | null>(null);
  const [pendingCloseId, setPendingCloseId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<RecentProject | null>(null);
  const updater = useAppUpdater();
  const stageRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const layout = useSplitLayout(workspace.tabs, workspace.activeTabId, workspace.setActiveTabId);
  const { drag, startDrag, consumedClick } = useSessionDrag(stageRef, sidebarRef, layout.panes, {
    onDrop: layout.dropTab,
    onEject: layout.closePane,
    // 只有分屏里的会话摘得动：没分屏时舞台始终跟着活动会话，摘掉也没地方去。
    canEject: (tabId) => layout.panes.length > 1 && layout.rects.has(tabId),
  });

  // 画在舞台上的那几条会话。没分屏时就是活动会话自己；用户看得见的就不必再弹通知。
  const visibleTabIds = useMemo(() => new Set(layout.rects.keys()), [layout.rects]);
  useActivityNotifications(workspace.tabs, visibleTabIds);
  // 名册推给 Rust，供 Agent 在自己的 PTY 里敲 `belfry peers` 时回答。
  useCollabSessions(workspace.tabs);

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

  const quickOpen = useQuickOpen({
    activateTab: layout.activateTab,
    activeTabId: workspace.activeTabId,
    recentProjects: workspace.recentProjects,
    selectProject: workspace.selectProject,
    tabs: workspace.tabs,
  });
  const terminalTargets = useTerminalTargets();
  const sharedContext = useSharedContext({ project: workspace.activeProject });
  const collab = useCollabTaskBoard();
  const promptQueue = usePromptQueue({ tabs: workspace.tabs, targets: terminalTargets.targets });
  // 别的会话派来的任务，投进同一条 Prompt 队列——派活不需要第二个执行引擎。
  useCollabTasks({
    readyTabIds: useMemo(() => new Set(terminalTargets.targets.keys()), [terminalTargets.targets]),
    enqueueRun: promptQueue.enqueueRun,
  });
  const recipes = useRecipes({
    enqueueRun: promptQueue.enqueueRun,
    queueItems: promptQueue.items,
    removePrompt: promptQueue.remove,
    removeRun: promptQueue.removeRun,
    tabs: workspace.tabs,
  });
  /**
   * 舞台上一次只留一个浮层：它们抢的是同一块可视区域和同一批快捷键。
   *
   * 收在一处而不是每个 toggle 里手写一串 setXxx(false)——那样每加一个浮层
   * 都要回头改所有旧的，漏一个就是两层叠着显示。
   */
  const closeOverlays = useCallback(() => {
    quickOpen.close();
    setComposerOpen(false);
    setCollabOpen(false);
    setContextOpen(false);
    setRecipesOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
  }, [quickOpen.close]);

  const toggleUsage = useCallback(() => {
    const next = !usageOpen;
    closeOverlays();
    setUsageOpen(next);
  }, [closeOverlays, usageOpen]);

  const toggleHistory = useCallback(() => {
    const next = !historyOpen;
    closeOverlays();
    setHistoryOpen(next);
  }, [closeOverlays, historyOpen]);

  const toggleQuickOpen = useCallback(() => {
    const next = !quickOpen.open;
    closeOverlays();
    if (next) quickOpen.toggle();
  }, [closeOverlays, quickOpen.open, quickOpen.toggle]);

  const toggleComposer = useCallback(() => {
    const next = !composerOpen;
    closeOverlays();
    setComposerOpen(next);
  }, [closeOverlays, composerOpen]);

  const toggleRecipes = useCallback(() => {
    const next = !recipesOpen;
    closeOverlays();
    setRecipesOpen(next);
  }, [closeOverlays, recipesOpen]);

  const toggleCollab = useCallback(() => {
    const next = !collabOpen;
    closeOverlays();
    setCollabOpen(next);
  }, [closeOverlays, collabOpen]);

  const toggleContext = useCallback(() => {
    const next = !contextOpen;
    closeOverlays();
    setContextOpen(next);
  }, [closeOverlays, contextOpen]);

  /** 把某条会话当前选中的终端内容存成一条上下文。没选中就什么也不做。 */
  const captureSelection = useCallback((tabId: string) => {
    const target = terminalTargets.targets.get(tabId);
    const text = target?.readSelection() ?? "";
    if (text.trim().length === 0) return;
    const tab = workspace.tabs.find((item) => item.id === tabId);
    void sharedContext.add({
      kind: "excerpt",
      title: "",
      body: text,
      // 记来路：从屏幕上抓的和用户手敲的可信度不一样。
      source: { from: "terminal", tabId },
      tags: tab ? [tab.title] : [],
    });
  }, [sharedContext.add, terminalTargets.targets, workspace.tabs]);

  const addContextNote = useCallback((title: string, body: string) => {
    void sharedContext.add({ kind: "note", title, body, source: { from: "user" } });
  }, [sharedContext.add]);

  /**
   * 把一条上下文的引用送进当前会话的输入行。
   *
   * 走 sendText 会直接回车提交，这里只想把引用放进输入框让用户接着写，
   * 所以先关面板再插——插入后焦点回到终端。
   */
  const insertContext = useCallback((item: ContextItem) => {
    const tabId = workspace.activeTabId;
    const target = tabId ? terminalTargets.targets.get(tabId) : null;
    if (!target) return;
    setContextOpen(false);
    target.focus();
    // paste 不带回车：引用只是开头，用户还要补自己的问题。
    target.insertText(`${contextReference(item)} `);
  }, [terminalTargets.targets, workspace.activeTabId]);

  const openPreview = useCallback((request?: PreviewRequest) => {
    closeOverlays();
    setPreviewOpen(true);
    setPreviewRequest(request ?? null);
  }, [closeOverlays]);

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
    composerOpen,
    collabOpen,
    contextOpen,
    quickOpenOpen: quickOpen.open,
    recipesOpen,
    onActivateSession: (index) => {
      const tab = groupTabsByProject(workspace.tabs).flatMap((group) => group.tabs)[index];
      if (tab) layout.activateTab(tab.id);
    },
    onNewShell: () => launch("shell"),
    onOpenSettings: () => setSettingsOpen(true),
    onToggleHistory: toggleHistory,
    onToggleComposer: toggleComposer,
    onToggleCollab: toggleCollab,
    onToggleContext: toggleContext,
    onToggleQuickOpen: toggleQuickOpen,
    onToggleRecipes: toggleRecipes,
    onToggleSidebar: () => setCollapsed((value) => !value),
    onToggleUsage: toggleUsage,
  });

  const selectQuickOpenItem = useCallback((item: QuickOpenItem) => {
    quickOpen.select(item, (id) => {
      switch (id) {
        case "action:new-shell": launch("shell"); break;
        case "action:composer":
          closeOverlays();
          setComposerOpen(true);
          break;
        case "action:recipes":
          closeOverlays();
          setRecipesOpen(true);
          break;
        case "action:context":
          closeOverlays();
          setContextOpen(true);
          break;
        case "action:collab":
          closeOverlays();
          setCollabOpen(true);
          break;
        case "action:file-preview": openPreview(); break;
        case "action:settings": setSettingsOpen(true); break;
        case "action:history": toggleHistory(); break;
        case "action:usage": toggleUsage(); break;
        case "action:sidebar": setCollapsed((value) => !value); break;
        case "action:shortcuts": shortcuts.openGuide(); break;
        default: break;
      }
    });
  }, [launch, openPreview, quickOpen, shortcuts, toggleHistory, toggleUsage]);

  return (
    <main
      className={`app-shell${collapsed ? " is-collapsed" : ""}${usageOpen ? " has-usage" : ""}${historyOpen ? " has-history" : ""}${previewOpen ? " has-preview" : ""}${settingsOpen ? " is-settings" : ""}`}
    >
      <AppBackground />
      <WindowTitlebar />

      {collapsed ? null : (
        <Sidebar
          activeId={workspace.activeTabId}
          agents={workspace.agents}
          shellProfiles={workspace.shellProfiles}
          draggingId={drag?.tabId ?? null}
          ejecting={drag?.target?.kind === "sidebar"}
          foldedProjects={foldedProjects}
          onActivate={layout.activateTab}
          onClose={requestClose}
          onRename={workspace.renameTab}
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
          historyOpen={historyOpen}
          onOpenUpdater={updater.openPanel}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsOpen={settingsOpen}
          ref={sidebarRef}
          tabs={workspace.tabs}
          updaterOpen={updater.open}
          updaterState={updater.state}
          usageOpen={usageOpen}
        />
      )}

      <Workbench
        activeProject={workspace.activeProject}
        activeTabId={workspace.activeTabId}
        collapsed={collapsed}
        composerOpen={composerOpen}
        dividers={layout.dividers}
        drag={drag}
        onAbortRun={recipes.abortRun}
        onClearRun={recipes.clearRun}
        onCloseComposer={() => setComposerOpen(false)}
        onCloseRecipes={() => setRecipesOpen(false)}
        onClosePane={layout.closePane}
        onDraftRecipe={recipes.draft}
        onDuplicateRecipe={recipes.duplicateRecipe}
        onDragStart={startDrag}
        onFocus={workspace.setActiveTabId}
        onLaunchShell={() => launch("shell")}
        onOpenProject={workspace.selectProject}
        onOpenShortcutGuide={shortcuts.openGuide}
        onRegisterTarget={terminalTargets.register}
        onOpenFile={openTerminalFile}
        onRemovePrompt={promptQueue.remove}
        onRemoveRecipe={recipes.removeRecipe}
        onRequestRemove={setPendingRemove}
        onResendStep={recipes.resendStep}
        onResize={layout.resizeSplit}
        onRevealSidebar={() => setCollapsed(false)}
        onSaveRecipe={recipes.saveRecipe}
        onSendPromptNow={promptQueue.sendNow}
        onSkipStep={recipes.skipStep}
        onSnapshot={workspace.updateTab}
        onStartRun={recipes.startRun}
        onSubmitPrompt={promptQueue.submit}
        onToggleComposer={toggleComposer}
        onTogglePreview={togglePreview}
        onToggleQuickOpen={toggleQuickOpen}
        onToggleRecipes={toggleRecipes}
        onToggleContext={toggleContext}
        onToggleCollab={toggleCollab}
        onApproveTask={collab.approve}
        onRejectTask={collab.reject}
        onStopAllTasks={collab.stopAll}
        collabActive={collab.active}
        collabOpen={collabOpen}
        collabPending={collab.pendingApproval}
        collabTasks={collab.tasks}
        onAddContextNote={addContextNote}
        onCaptureSelection={captureSelection}
        onInsertContext={insertContext}
        onRemoveContext={sharedContext.remove}
        onTogglePinContext={sharedContext.togglePin}
        contextFailure={sharedContext.failure}
        contextItems={sharedContext.items}
        contextLoading={sharedContext.loading}
        contextOpen={contextOpen}
        opening={workspace.opening}
        promptItems={promptQueue.items}
        previewOpen={previewOpen}
        quickOpenOpen={quickOpen.open}
        recentProjects={workspace.recentProjects}
        recipes={recipes.recipes}
        recipesOpen={recipesOpen}
        rects={layout.rects}
        runs={recipes.runs}
        shortcutGuideOpen={shortcuts.guideOpen}
        shortcutPlatform={shortcuts.platform}
        split={layout.split}
        stageRef={stageRef}
        tabs={workspace.tabs}
      />

      {previewOpen ? (
        <FilePreviewPane
          onClose={() => {
            setPreviewOpen(false);
            setPreviewRequest(null);
          }}
          project={workspace.activeProject}
          requestedLine={previewRequest?.line ?? null}
          requestedPath={previewRequest?.path ?? null}
        />
      ) : null}

      <AppOverlays
        failure={workspace.failure}
        historyOpen={historyOpen}
        onCancelClose={cancelClose}
        onCancelRemove={() => setPendingRemove(null)}
        onCheckUpdate={updater.checkNow}
        onCloseHistory={() => setHistoryOpen(false)}
        onCloseQuickOpen={quickOpen.close}
        onCloseSettings={() => setSettingsOpen(false)}
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
        settingsOpen={settingsOpen}
        shortcutGuideOpen={shortcuts.guideOpen}
        shortcutPlatform={shortcuts.platform}
        updaterOpen={updater.open}
        updaterState={updater.state}
        usageOpen={usageOpen}
      />
    </main>
  );
}
