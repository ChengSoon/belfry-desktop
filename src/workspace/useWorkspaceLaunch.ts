import { useCallback } from "react";
import { isShellProfileId, type ShellProfileId, type SshLaunch } from "../terminal/contracts";
import { openProject } from "./api";
import type { AppFailure, ProjectWorkspace, WorkspaceTabKind } from "./contracts";
import { toAppFailure } from "./errors";
import { pathKey } from "./path";
import { configureNewProjectTab } from "./projects/launch";
import { createWorkspaceTab, nextOrdinal } from "./tabs";
import type { NamedWorkspaces } from "./named/useNamedWorkspaces";
import type { useWorkspaceEnvironment } from "./useWorkspaceEnvironment";
import type { useWorkspaceProjects } from "./useWorkspaceProjects";
import type { WorkspaceState } from "./useWorkspaceState";

export interface LaunchOptions {
  state: WorkspaceState;
  environment: ReturnType<typeof useWorkspaceEnvironment>;
  projects: ReturnType<typeof useWorkspaceProjects>;
  registerTab: NamedWorkspaces["registerTab"];
}

export function useWorkspaceLaunch({ state, environment, projects, registerTab }: LaunchOptions) {
  const { tabs, setTabs, setFailure } = state;
  const { activeProject, acceptProject } = projects;
  const { agents, shellProfiles } = environment;
  const launch = useCallback(async (kind: WorkspaceTabKind, requestedProfile?: ShellProfileId,
    projectRoot?: string, activate = true, collaborationMode = false): Promise<string | null> => {
    const profileId = kind === "shell" ? requestedProfile ?? "system-default" : null;
    const unavailable = launchFailure({ agents, shellProfiles }, { kind, profileId });
    if (unavailable) { setFailure(unavailable); return null; }
    try {
      const target = await resolveLaunchProject(activeProject, { projectRoot, activate, acceptProject });
      // UUID 与启动意图在 updater 外创建，StrictMode 重放不会改变会话身份。
      const tab = configureNewProjectTab(createWorkspaceTab(target, kind, nextOrdinal(tabs, kind),
        null, null, profileId && isShellProfileId(profileId) ? profileId : "system-default",
        collaborationMode), requestedProfile);
      setTabs((current) => [...current, tab]);
      registerTab(tab.id, activate);
      return tab.id;
    } catch (error) { setFailure(toAppFailure(error)); return null; }
  }, [acceptProject, activeProject, agents, registerTab, setFailure, setTabs, shellProfiles, tabs]);
  const launchSsh = useCallback(async (target: SshLaunch) => {
    try {
      const project = await resolveLaunchProject(activeProject, { activate: true, acceptProject });
      const tab = createWorkspaceTab(project, "ssh", nextOrdinal(tabs, "ssh"), null, target);
      setTabs((current) => [...current, tab]);
      registerTab(tab.id);
    } catch (error) { setFailure(toAppFailure(error)); }
  }, [acceptProject, activeProject, registerTab, setFailure, setTabs, tabs]);
  return { launch, launchSsh };
}

interface TargetOptions {
  projectRoot?: string;
  activate: boolean;
  acceptProject: (project: ProjectWorkspace) => void;
}

export async function resolveLaunchProject(active: ProjectWorkspace | null, options: TargetOptions) {
  if (active && (!options.projectRoot || pathKey(active.rootPath) === pathKey(options.projectRoot))) return active;
  const project = await openProject(options.projectRoot || null);
  if (options.activate) options.acceptProject(project);
  return project;
}

function launchFailure(environment: Pick<LaunchOptions["environment"], "agents" | "shellProfiles">,
  request: { kind: WorkspaceTabKind; profileId: ShellProfileId | null }): AppFailure | null {
  const { kind, profileId } = request;
  const shell = profileId && profileId !== "system-default"
    ? environment.shellProfiles.find((profile) => profile.id === profileId) : null;
  if (shell && !shell.available) {
    return { code: "NOT_FOUND", message: shell.reason ?? `${profileId} 不可用`, retryable: true };
  }
  const agent = kind === "codex" || kind === "claude"
    ? environment.agents.find((item) => item.kind === kind) : null;
  return agent && !agent.available
    ? { code: "NOT_FOUND", message: agent.reason ?? `${kind} 不可用`, retryable: true } : null;
}
