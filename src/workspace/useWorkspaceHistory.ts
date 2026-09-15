import { useCallback } from "react";
import { isAgentSessionRef } from "../agent/contracts";
import type { HistorySession } from "../history/contracts";
import { openProject } from "./api";
import type { AgentAvailability, AppFailure, ProjectWorkspace } from "./contracts";
import { toAppFailure } from "./errors";
import { configureNewProjectTab } from "./projects/launch";
import { createWorkspaceTab, nextOrdinal } from "./tabs";
import { resolveLaunchProject, type LaunchOptions } from "./useWorkspaceLaunch";

export function useWorkspaceHistory({ state, projects, environment, registerTab }: LaunchOptions) {
  const { setTabs, setFailure } = state;
  const { activeProject, acceptProject } = projects;
  const { waitForAgents } = environment;
  return useCallback(async (session: HistorySession) => {
    // 历史扫描和检测并行，pending 不能被当成最终的不可用结果。
    const detected = await waitForAgents();
    const failure = validateHistoryResume(session, detected);
    if (failure) { setFailure(failure); return; }
    try {
      const target = await historyProject(session, activeProject, acceptProject);
      const { agent: kind, id: sessionId } = session.sessionRef;
      const prepared = configureNewProjectTab(createWorkspaceTab(target, kind, 1, sessionId));
      const id = prepared.id;
      // 批量恢复时，在 updater 内取最新序号，但复用已生成的 UUID 与启动意图。
      setTabs((current) => [...current, { ...createWorkspaceTab(target, kind,
        nextOrdinal(current, kind), sessionId), id, projectLaunch: prepared.projectLaunch }]);
      registerTab(id);
    } catch (error) { setFailure(toAppFailure(error)); }
  }, [acceptProject, activeProject, registerTab, setFailure, setTabs, waitForAgents]);
}

async function historyProject(session: HistorySession, active: ProjectWorkspace | null,
  acceptProject: (project: ProjectWorkspace) => void) {
  if (session.cwd) {
    try {
      const project = await openProject(session.cwd);
      acceptProject(project);
      return project;
    } catch { /* 原目录已不存在，退回活动项目。 */ }
  }
  return resolveLaunchProject(active, { activate: true, acceptProject });
}

export function validateHistoryResume(session: HistorySession, agents: AgentAvailability[]): AppFailure | null {
  if (!isAgentSessionRef(session.sessionRef) || session.agent !== session.sessionRef.agent
    || session.id !== session.sessionRef.id) {
    return { code: "INVALID_ARGUMENT", message: "历史会话的 Agent 身份不一致，无法恢复", retryable: false };
  }
  const availability = agents.find((item) => item.kind === session.sessionRef.agent);
  if (!availability?.available) {
    return { code: "NOT_FOUND", message: availability?.reason ?? `${session.sessionRef.agent} 不可用`, retryable: true };
  }
  if (!availability.descriptor.capabilities.resume) {
    return { code: "UNSUPPORTED", message: `${availability.descriptor.displayName} 不支持恢复历史会话`, retryable: false };
  }
  return null;
}
