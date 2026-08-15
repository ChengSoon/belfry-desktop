import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalSnapshot } from "../components/TerminalViewport";
import { detectAgents, openProject } from "./api";
import type { HistorySession } from "../history/contracts";
import type {
  AgentAvailability,
  AgentKind,
  AppFailure,
  ProjectWorkspace,
  RecentProject,
  WorkspaceTab,
  WorkspaceTabKind,
} from "./contracts";
import { toAppFailure } from "./errors";
import { pathKey } from "./path";
import {
  loadRecentProjects,
  loadWorkspaceState,
  rememberProject,
  removeRecentProject as removeRecentProjectEntry,
  saveRecentProjects,
  saveWorkspaceState,
  serializeWorkspaceState,
} from "./storage";
import {
  applySnapshot,
  closeTabsForPath,
  createProjectSwitchTab,
  createWorkspaceTab,
  nextActiveTab,
  nextOrdinal,
} from "./tabs";

export function useProjectWorkspace() {
  const restoredWorkspace = useMemo(loadWorkspaceState, []);
  const initialProjectPath = useRef(
    restoredWorkspace?.tabs.find((tab) => tab.id === restoredWorkspace.activeTabId)?.project.rootPath
      ?? loadRecentProjects()[0]?.rootPath
      ?? null,
  );
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => restoredWorkspace?.tabs ?? []);
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => restoredWorkspace?.activeTabId ?? null,
  );
  // 没有活动会话时新建会话该开在哪；有活动会话时一律继承它的项目。
  const [lastProject, setLastProject] = useState<ProjectWorkspace | null>(() => (
    restoredWorkspace?.tabs.find((tab) => tab.id === restoredWorkspace.activeTabId)?.project
      ?? restoredWorkspace?.tabs[0]?.project
      ?? null
  ));
  const [agents, setAgents] = useState<AgentAvailability[]>(pendingAgents());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecentProjects);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [opening, setOpening] = useState(true);
  const [readyToPersist, setReadyToPersist] = useState(restoredWorkspace !== null);
  const requestVersion = useRef(0);
  const lastPersistedWorkspace = useRef<string | null>(null);

  const activeProject = tabs.find((tab) => tab.id === activeTabId)?.project ?? lastProject;

  const acceptProject = useCallback((workspace: ProjectWorkspace) => {
    setLastProject(workspace);
    setRecentProjects((current) => persistRecent(workspace, current));
  }, []);

  /**
   * 选项目 = 为目标目录创建一个新会话并激活它。当前会话继续保留，避免改 cwd
   * 触发 PTY 重启后丢失滚屏和前台进程。
   */
  const selectProject = useCallback(async (path: string | null) => {
    const version = ++requestVersion.current;
    setOpening(true);
    setFailure(null);
    try {
      const workspace = await openProject(path);
      if (version !== requestVersion.current) return;
      const tab = createProjectSwitchTab(tabs, workspace);
      setTabs((current) => [...current, tab]);
      setActiveTabId(tab.id);
      acceptProject(workspace);
    } catch (error) {
      if (version === requestVersion.current) setFailure(toAppFailure(error));
    } finally {
      if (version === requestVersion.current) setOpening(false);
    }
  }, [acceptProject, tabs]);

  useEffect(() => {
    void bootstrap();
    async function bootstrap() {
      const version = ++requestVersion.current;
      try {
        if (restoredWorkspace) {
          const restoredProject = restoredWorkspace.tabs.find(
            (tab) => tab.id === restoredWorkspace.activeTabId,
          )?.project ?? restoredWorkspace.tabs[0]?.project;
          if (restoredProject) acceptProject(restoredProject);
          const detected = await loadAgentState();
          if (version === requestVersion.current) setAgents(detected);
          return;
        }
        const workspace = await openProject(initialProjectPath.current);
        if (version !== requestVersion.current) return;
        const tab = createWorkspaceTab(workspace, "shell", 1);
        setTabs([tab]);
        setActiveTabId(tab.id);
        acceptProject(workspace);
        const detected = await loadAgentState();
        if (version === requestVersion.current) setAgents(detected);
      } catch (error) {
        if (version === requestVersion.current) setFailure(toAppFailure(error));
      } finally {
        if (version === requestVersion.current) {
          setOpening(false);
          setReadyToPersist(true);
        }
      }
    }
  }, [acceptProject, restoredWorkspace]);

  // 序列化结果排除了 phase/activity/error，因此终端刷屏不会反复写 localStorage。
  const serializedWorkspace = serializeWorkspaceState(tabs, activeTabId);
  useEffect(() => {
    if (readyToPersist && serializedWorkspace !== lastPersistedWorkspace.current) {
      saveWorkspaceState(tabs, activeTabId);
      lastPersistedWorkspace.current = serializedWorkspace;
    }
  }, [activeTabId, readyToPersist, serializedWorkspace, tabs]);

  const launch = useCallback(async (kind: WorkspaceTabKind) => {
    const availability = kind === "shell" ? null : agents.find((agent) => agent.kind === kind);
    if (availability && !availability.available) {
      setFailure({ code: "NOT_FOUND", message: availability.reason ?? `${kind} 不可用`, retryable: true });
      return;
    }
    // 首启失败等边缘情况下没有任何项目可继承，先要后端给一个默认目录。
    let target = activeProject;
    if (!target) {
      try {
        target = await openProject(null);
        acceptProject(target);
      } catch (error) {
        setFailure(toAppFailure(error));
        return;
      }
    }
    // tab 必须在 updater 外建：updater 在 StrictMode 下会跑两次，
    // 每次 randomUUID 不同，setActiveTabId 就会指向一个被丢弃的 id。
    const tab = createWorkspaceTab(target, kind, nextOrdinal(tabs, kind));
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, [acceptProject, activeProject, agents, tabs]);

  /**
   * 从历史会话面板恢复一条会话：优先在会话原目录里新开（目录没了退回当前项目），
   * 启动参数带上 resumeSessionId，PTY 起来时直接进 resume。
   */
  const launchHistorySession = useCallback(async (kind: AgentKind, session: HistorySession) => {
    let target = activeProject;
    if (session.cwd) {
      try {
        const workspace = await openProject(session.cwd);
        acceptProject(workspace);
        target = workspace;
      } catch {
        // 原目录已不存在，退回当前活动项目继续。
      }
    }
    if (!target) {
      try {
        target = await openProject(null);
        acceptProject(target);
      } catch (error) {
        setFailure(toAppFailure(error));
        return;
      }
    }
    // id 必须在 updater 外生成：updater 在 StrictMode 下会跑两次，
    // 每次 randomUUID 不同，setActiveTabId 就会指向一个被丢弃的 id。
    const id = crypto.randomUUID();
    // 序号在 updater 内基于最新列表计算：批量打开多条时不会全部叫 "Codex 01"。
    setTabs((current) => [
      ...current,
      { ...createWorkspaceTab(target, kind, nextOrdinal(current, kind), session.id), id },
    ]);
    setActiveTabId(id);
  }, [acceptProject, activeProject]);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const next = nextActiveTab(current, id);
      if (activeTabId === id) setActiveTabId(next.activeId);
      return next.remaining;
    });
  }, [activeTabId]);

  /**
   * 删除最近项目：从列表移除记录，并关闭该目录下所有会话（PTY 被杀）。
   * 用户已通过删除确认框确认，这里不再走 needsCloseConfirm 二次拦截。
   * 整目录一次函数式更新关闭（closeTabsForPath），避免逐个 closeTab 把活动
   * 切到同目录的下一个会话、关完后再悬空成一个已删除的 id。
   * 该目录是唯一有会话的目录时，若最近列表还有其他目录，自动打开最近的一条
   * 补位，否则切换器会停在"正在定位…"。
   */
  const removeRecentProject = useCallback((id: string) => {
    const target = recentProjects.find((project) => project.id === id);
    if (!target) return;
    const targetKey = pathKey(target.rootPath);
    const next = removeRecentProjectEntry(recentProjects, id);
    saveRecentProjects(next);
    setRecentProjects(next);
    setTabs((current) => {
      const result = closeTabsForPath(current, activeTabId, target.rootPath);
      if (result.activeId !== activeTabId) setActiveTabId(result.activeId);
      return result.remaining;
    });
    if (lastProject && pathKey(lastProject.rootPath) === targetKey) setLastProject(null);
    const otherTabOpen = tabs.some((tab) => pathKey(tab.project.rootPath) !== targetKey);
    if (!otherTabOpen && next.length > 0) {
      void openProject(next[0].rootPath)
        .then((workspace) => {
          const tab = createWorkspaceTab(workspace, "shell", 1);
          setTabs([tab]);
          setActiveTabId(tab.id);
          acceptProject(workspace);
        })
        .catch((error) => setFailure(toAppFailure(error)));
    }
  }, [acceptProject, activeTabId, lastProject, recentProjects, tabs]);

  const updateTab = useCallback((id: string, snapshot: TerminalSnapshot) => {
    setTabs((current) => current.map((tab) => (
      tab.id === id ? applySnapshot(tab, snapshot) : tab
    )));
  }, []);

  const redetectAgents = useCallback(async () => {
    const version = requestVersion.current;
    setAgents(pendingAgents());
    const detected = await loadAgentState();
    if (version === requestVersion.current) setAgents(detected);
  }, []);

  return {
    activeProject,
    agents,
    tabs,
    activeTabId,
    recentProjects,
    failure,
    opening,
    selectProject,
    launch,
    launchHistorySession,
    closeTab,
    removeRecentProject,
    updateTab,
    redetectAgents,
    setActiveTabId,
    dismissFailure: () => setFailure(null),
  };
}

function pendingAgents(): AgentAvailability[] {
  return (["codex", "claude"] as AgentKind[]).map((kind) => ({
    kind,
    available: false,
    executable: null,
    version: null,
    reason: "正在检测用户命令环境…",
  }));
}

async function loadAgentState() {
  try {
    return await detectAgents();
  } catch (error) {
    const message = toAppFailure(error).message;
    return pendingAgents().map((agent) => ({ ...agent, reason: message }));
  }
}

function persistRecent(project: ProjectWorkspace, current: RecentProject[]) {
  const next = rememberProject(project, current);
  saveRecentProjects(next);
  return next;
}
