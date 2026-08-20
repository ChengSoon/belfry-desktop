import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentDescriptor, isAgentSessionRef } from "../agent/contracts";
import type { TerminalSnapshot } from "../components/TerminalViewport";
import {
  isShellProfileId,
  sshDisplayName,
  type ShellProfile,
  type ShellProfileId,
  type SshLaunch,
} from "../terminal/contracts";
import { detectAgents, openProject } from "./api";
import { listShellProfiles } from "../terminal/api";
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
  updateSshTarget,
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
  const [shellProfiles, setShellProfiles] = useState<ShellProfile[]>(pendingShellProfiles());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecentProjects);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const [opening, setOpening] = useState(true);
  const [readyToPersist, setReadyToPersist] = useState(restoredWorkspace !== null);
  const agentDetectionPromise = useRef<Promise<AgentAvailability[]> | null>(null);
  const agentDetectionGeneration = useRef(0);
  const requestVersion = useRef(0);
  const lastPersistedWorkspace = useRef<string | null>(null);

  const activeProject = tabs.find((tab) => tab.id === activeTabId)?.project ?? lastProject;

  const acceptProject = useCallback((workspace: ProjectWorkspace) => {
    setLastProject(workspace);
    setRecentProjects((current) => persistRecent(workspace, current));
  }, []);

  const startAgentDetection = useCallback(() => {
    const generation = ++agentDetectionGeneration.current;
    setAgents(pendingAgents());
    const promise = loadAgentState();
    agentDetectionPromise.current = promise;
    void promise.then((detected) => {
      if (generation === agentDetectionGeneration.current) setAgents(detected);
    });
    return promise;
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
      const agentDetection = startAgentDetection();
      try {
        if (restoredWorkspace) {
          const restoredProject = restoredWorkspace.tabs.find(
            (tab) => tab.id === restoredWorkspace.activeTabId,
          )?.project ?? restoredWorkspace.tabs[0]?.project;
          if (restoredProject) acceptProject(restoredProject);
          const [, shells] = await Promise.all([agentDetection, loadShellProfileState()]);
          if (version === requestVersion.current) {
            setShellProfiles(shells);
          }
          return;
        }
        const workspace = await openProject(initialProjectPath.current);
        if (version !== requestVersion.current) return;
        const tab = createWorkspaceTab(workspace, "shell", 1);
        setTabs([tab]);
        setActiveTabId(tab.id);
        acceptProject(workspace);
        const [, shells] = await Promise.all([agentDetection, loadShellProfileState()]);
        if (version === requestVersion.current) {
          setShellProfiles(shells);
        }
      } catch (error) {
        if (version === requestVersion.current) setFailure(toAppFailure(error));
      } finally {
        if (version === requestVersion.current) {
          setOpening(false);
          setReadyToPersist(true);
        }
      }
    }
  }, [acceptProject, restoredWorkspace, startAgentDetection]);

  // 序列化结果排除了 phase/activity/error，因此终端刷屏不会反复写 localStorage。
  const serializedWorkspace = serializeWorkspaceState(tabs, activeTabId);
  useEffect(() => {
    if (readyToPersist && serializedWorkspace !== lastPersistedWorkspace.current) {
      saveWorkspaceState(tabs, activeTabId);
      lastPersistedWorkspace.current = serializedWorkspace;
    }
  }, [activeTabId, readyToPersist, serializedWorkspace, tabs]);

  const launch = useCallback(async (kind: WorkspaceTabKind, requestedProfile?: ShellProfileId) => {
    const profileId = kind === "shell" ? requestedProfile ?? "system-default" : null;
    const shellAvailability = profileId && profileId !== "system-default"
      ? shellProfiles.find((profile) => profile.id === profileId)
      : null;
    if (shellAvailability && !shellAvailability.available) {
      setFailure({
        code: "NOT_FOUND",
        message: shellAvailability.reason ?? `${profileId} 不可用`,
        retryable: true,
      });
      return;
    }
    const availability = kind === "codex" || kind === "claude"
      ? agents.find((agent) => agent.kind === kind)
      : null;
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
    const tab = createWorkspaceTab(
      target,
      kind,
      nextOrdinal(tabs, kind),
      null,
      null,
      profileId && isShellProfileId(profileId) ? profileId : "system-default",
    );
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, [acceptProject, activeProject, agents, shellProfiles, tabs]);

  /** SSH 会话：凭证不落地，连接在终端里由 OpenSSH 交互，这里只建 tab。 */
  const launchSsh = useCallback(async (target: SshLaunch) => {
    // 首启失败等边缘情况下没有任何项目可继承，先要后端给一个默认目录。
    let project = activeProject;
    if (!project) {
      try {
        project = await openProject(null);
        acceptProject(project);
      } catch (error) {
        setFailure(toAppFailure(error));
        return;
      }
    }
    const tab = createWorkspaceTab(project, "ssh", nextOrdinal(tabs, "ssh"), null, target);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
  }, [acceptProject, activeProject, tabs]);

  /**
   * 从历史会话面板恢复一条会话：优先在会话原目录里新开（目录没了退回当前项目），
   * 启动参数带上 resumeSessionId，PTY 起来时直接进 resume。
   */
  const launchHistorySession = useCallback(async (session: HistorySession) => {
    // 历史扫描和 Agent 检测并行；恢复必须等检测结果，不能把 pending 当成不可用。
    const detectedAgents = await (agentDetectionPromise.current ?? startAgentDetection());
    const validationFailure = validateHistoryResume(session, detectedAgents);
    if (validationFailure) {
      setFailure(validationFailure);
      return;
    }
    const { agent: kind, id: sessionId } = session.sessionRef;
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
      { ...createWorkspaceTab(target, kind, nextOrdinal(current, kind), sessionId), id },
    ]);
    setActiveTabId(id);
  }, [acceptProject, activeProject, startAgentDetection]);

  const closeTab = useCallback((id: string) => {
    setTabs((current) => {
      const next = nextActiveTab(current, id);
      if (activeTabId === id) setActiveTabId(next.activeId);
      return next.remaining;
    });
  }, [activeTabId]);

  /**
   * 重命名会话。目前只有 SSH 支持：手动名记在 customTitle 里，
   * 之后快照合并不会再把它顶掉；传 null 或空串则退回默认名（连接目标）。
   */
  const renameTab = useCallback((id: string, customTitle: string | null) => {
    setTabs((current) => current.map((tab) => {
      if (tab.id !== id || tab.kind !== "ssh") return tab;
      const fallback = tab.sshTarget ? sshDisplayName(tab.sshTarget) : tab.title;
      const title = customTitle?.trim() || fallback;
      return { ...tab, title, customTitle: title === fallback ? null : title };
    }));
  }, []);

  /** 修改 SSH 目标后复用当前 tab；sshTarget 变化会让终端层自动重连。 */
  const updateSsh = useCallback((id: string, target: SshLaunch) => {
    setTabs((current) => current.map((tab) => (
      tab.id === id ? updateSshTarget(tab, target) : tab
    )));
  }, []);

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
    const agentDetection = startAgentDetection();
    setShellProfiles(pendingShellProfiles());
    const [, shells] = await Promise.all([agentDetection, loadShellProfileState()]);
    if (version === requestVersion.current) {
      setShellProfiles(shells);
    }
  }, [startAgentDetection]);

  return {
    activeProject,
    agents,
    shellProfiles,
    tabs,
    activeTabId,
    recentProjects,
    failure,
    opening,
    selectProject,
    launch,
    launchSsh,
    launchHistorySession,
    closeTab,
    renameTab,
    updateSsh,
    removeRecentProject,
    updateTab,
    redetectAgents,
    setActiveTabId,
    dismissFailure: () => setFailure(null),
  };
}

function pendingAgents(): AgentAvailability[] {
  return (["codex", "claude"] as AgentKind[]).map((kind) => ({
    descriptor: agentDescriptor(kind),
    kind,
    available: false,
    executable: null,
    version: null,
    reason: "正在检测用户命令环境…",
  }));
}

function pendingShellProfiles(): ShellProfile[] {
  const ids: ShellProfileId[] = [
    "system-default",
    "shell:zsh",
    "shell:bash",
    "shell:fish",
    "shell:pwsh",
    "shell:powershell",
    "shell:cmd",
    "shell:wsl",
    "shell:git-bash",
  ];
  return ids.map((id) => ({
    id,
    available: false,
    executable: null,
    isDefault: id === "system-default",
    reason: "正在检测可用 Shell…",
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

async function loadShellProfileState() {
  try {
    return await listShellProfiles();
  } catch (error) {
    const message = toAppFailure(error).message;
    return pendingShellProfiles().map((profile) => ({ ...profile, reason: message }));
  }
}

function persistRecent(project: ProjectWorkspace, current: RecentProject[]) {
  const next = rememberProject(project, current);
  saveRecentProjects(next);
  return next;
}

function validateHistoryResume(
  session: HistorySession,
  agents: AgentAvailability[],
): AppFailure | null {
  if (!isAgentSessionRef(session.sessionRef)
    || session.agent !== session.sessionRef.agent
    || session.id !== session.sessionRef.id) {
    return {
      code: "INVALID_ARGUMENT",
      message: "历史会话的 Agent 身份不一致，无法恢复",
      retryable: false,
    };
  }
  const availability = agents.find((item) => item.kind === session.sessionRef.agent);
  if (!availability?.available) {
    return {
      code: "NOT_FOUND",
      message: availability?.reason ?? `${session.sessionRef.agent} 不可用`,
      retryable: true,
    };
  }
  if (!availability.descriptor.capabilities.resume) {
    return {
      code: "UNSUPPORTED",
      message: `${availability.descriptor.displayName} 不支持恢复历史会话`,
      retryable: false,
    };
  }
  return null;
}
