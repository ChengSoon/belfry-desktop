import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalSnapshot } from "../components/TerminalViewport";
import { detectAgents, openProject } from "./api";
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
import { loadRecentProjects, rememberProject, saveRecentProjects } from "./storage";
import { applySnapshot, createWorkspaceTab, nextActiveTab, nextOrdinal } from "./tabs";

export function useProjectWorkspace() {
  const initialProjectPath = useRef(loadRecentProjects()[0]?.rootPath ?? null);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  // 没有活动会话时新建会话该开在哪；有活动会话时一律继承它的项目。
  const [lastProject, setLastProject] = useState<ProjectWorkspace | null>(null);
  const [agents, setAgents] = useState<AgentAvailability[]>(pendingAgents());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecentProjects);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [opening, setOpening] = useState(true);
  const requestVersion = useRef(0);

  const activeProject = tabs.find((tab) => tab.id === activeTabId)?.project ?? lastProject;

  const acceptProject = useCallback((workspace: ProjectWorkspace) => {
    setLastProject(workspace);
    setRecentProjects((current) => persistRecent(workspace, current));
  }, []);

  /**
   * 选项目 = 改写当前会话的归属。cwd 只能在 spawn 时定，所以改 tab.project 会
   * 连带重启该会话的 PTY（滚屏和前台进程会丢），这是已确认的语义。
   */
  const selectProject = useCallback(async (path: string | null) => {
    const version = ++requestVersion.current;
    setOpening(true);
    setFailure(null);
    try {
      const workspace = await openProject(path);
      if (version !== requestVersion.current) return;
      if (activeTabId) {
        setTabs((current) => current.map((tab) => (
          // PTY 要重启，旧的活动状态跟着作废，否则新会话起来前一直挂着上一个的点。
          tab.id === activeTabId ? { ...tab, project: workspace, activity: "idle", error: null } : tab
        )));
      } else {
        const tab = createWorkspaceTab(workspace, "shell", 1);
        setTabs([tab]);
        setActiveTabId(tab.id);
      }
      acceptProject(workspace);
    } catch (error) {
      if (version === requestVersion.current) setFailure(toAppFailure(error));
    } finally {
      if (version === requestVersion.current) setOpening(false);
    }
  }, [acceptProject, activeTabId]);

  useEffect(() => {
    void bootstrap();
    async function bootstrap() {
      const version = ++requestVersion.current;
      try {
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
        if (version === requestVersion.current) setOpening(false);
      }
    }
  }, [acceptProject]);

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

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const next = nextActiveTab(current, id);
      if (activeTabId === id) setActiveTabId(next.activeId);
      return next.remaining;
    });
  }, [activeTabId]);

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
    closeTab,
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
