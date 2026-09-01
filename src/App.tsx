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
import { useSessionRoster } from "./collab/useSessionRoster";
import { useTaskDelivery } from "./collab/useTaskDelivery";
import { resolveAgentRename } from "./collab/naming";
import { CollabPanel } from "./collab/CollabPanel";
import { useCollabTasks } from "./collab/useCollabTasks";
import { awaitingApproval } from "./collab/taskTone";

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
  const [recipesOpen, setRecipesOpen] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
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
  const promptQueue = usePromptQueue({ tabs: workspace.tabs, targets: terminalTargets.targets });
  // `belfry send` 落下的任务由这里投进目标终端，走的是和手敲 prompt 同一条队列。
  useTaskDelivery(promptQueue.submit);
  const collab = useCollabTasks();
  const recipes = useRecipes({
    enqueueRun: promptQueue.enqueueRun,
    queueItems: promptQueue.items,
    removePrompt: promptQueue.remove,
    removeRun: promptQueue.removeRun,
    tabs: workspace.tabs,
  });
  // 历史会话与用量面板互斥：两者都占右侧一列，栅格只留了一条轨道。
  const toggleUsage = useCallback(() => {
    setHistoryOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setComposerOpen(false);
    setRecipesOpen(false);
    setCollabOpen(false);
    setUsageOpen((value) => !value);
  }, []);

  const toggleHistory = useCallback(() => {
    setUsageOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setComposerOpen(false);
    setRecipesOpen(false);
    setCollabOpen(false);
    setHistoryOpen((value) => !value);
  }, []);

  const toggleQuickOpen = useCallback(() => {
    setComposerOpen(false);
    setRecipesOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    quickOpen.toggle();
  }, [quickOpen.toggle]);

  const toggleComposer = useCallback(() => {
    quickOpen.close();
    setRecipesOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setComposerOpen((value) => !value);
  }, [quickOpen.close]);

  const toggleRecipes = useCallback(() => {
    quickOpen.close();
    setComposerOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setRecipesOpen((value) => !value);
  }, [quickOpen.close]);

  const toggleCollab = useCallback(() => {
    quickOpen.close();
    setComposerOpen(false);
    setRecipesOpen(false);
    setPreviewOpen(false);
    setPreviewRequest(null);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen((value) => !value);
  }, [quickOpen.close]);

  const openPreview = useCallback((request?: PreviewRequest) => {
    quickOpen.close();
    setComposerOpen(false);
    setRecipesOpen(false);
    setUsageOpen(false);
    setHistoryOpen(false);
    setCollabOpen(false);
    setPreviewOpen(true);
    setPreviewRequest(request ?? null);
  }, [quickOpen.close]);

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
          quickOpen.close();
          setUsageOpen(false);
          setHistoryOpen(false);
          setPreviewOpen(false);
          setPreviewRequest(null);
          setRecipesOpen(false);
          setComposerOpen(true);
          break;
        case "action:recipes":
          quickOpen.close();
          setUsageOpen(false);
          setHistoryOpen(false);
          setPreviewOpen(false);
          setPreviewRequest(null);
          setComposerOpen(false);
          setRecipesOpen(true);
          break;
        case "action:collab": toggleCollab(); break;
        case "action:file-preview": openPreview(); break;
        case "action:settings": setSettingsOpen(true); break;
        case "action:history": toggleHistory(); break;
        case "action:usage": toggleUsage(); break;
        case "action:sidebar": setCollapsed((value) => !value); break;
        case "action:shortcuts": shortcuts.openGuide(); break;
        default: break;
      }
    });
  }, [launch, openPreview, quickOpen, shortcuts, toggleCollab, toggleHistory, toggleUsage]);

  return (
    <main
      className={`app-shell${collapsed ? " is-collapsed" : ""}${usageOpen ? " has-usage" : ""}${historyOpen ? " has-history" : ""}${previewOpen ? " has-preview" : ""}${settingsOpen ? " is-settings" : ""}${collabOpen ? " has-collab" : ""}`}
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
        collabOpen={collabOpen}
        collabWaiting={awaitingApproval(collab.tasks).length}
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
        onToggleCollab={toggleCollab}
        onTogglePreview={togglePreview}
        onToggleQuickOpen={toggleQuickOpen}
        onToggleRecipes={toggleRecipes}
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

      {collabOpen ? <CollabPanel collab={collab} onClose={() => setCollabOpen(false)} /> : null}

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
