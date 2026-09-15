import { useEffect, useRef } from "react";
import { openProject } from "./api";
import { toAppFailure } from "./errors";
import { loadRecentProjects } from "./storage";
import { createWorkspaceTab } from "./tabs";
import type { useWorkspaceEnvironment } from "./useWorkspaceEnvironment";
import type { useWorkspaceProjects } from "./useWorkspaceProjects";
import type { WorkspaceState } from "./useWorkspaceState";
import type { NamedWorkspaces } from "./named/useNamedWorkspaces";

interface BootstrapOptions {
  state: WorkspaceState;
  environment: ReturnType<typeof useWorkspaceEnvironment>;
  projects: ReturnType<typeof useWorkspaceProjects>;
  registerTab: NamedWorkspaces["registerTab"];
}

export function useWorkspaceBootstrap({ state, environment, projects, registerTab }: BootstrapOptions) {
  // 固定首启参数与工作区归属；切换命名工作区不能重新执行 bootstrap。
  const initial = useRef({ state, environment, projects, registerTab });
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void bootstrap(initial.current);
  }, []);
}

async function bootstrap({ state, environment, projects, registerTab }: BootstrapOptions) {
  const { restoredWorkspace, requestVersion, setTabs, setFailure, setOpening, setReadyToPersist } = state;
  const version = ++requestVersion.current;
  const agentDetection = environment.startAgentDetection();
  try {
    if (restoredWorkspace) {
      const project = restoredWorkspace.tabs.find((tab) => tab.id === restoredWorkspace.activeTabId)?.project
        ?? restoredWorkspace.tabs[0]?.project;
      if (project) projects.acceptProject(project);
    } else {
      const workspace = await openProject(loadRecentProjects()[0]?.rootPath ?? null);
      if (version !== requestVersion.current) return;
      const tab = createWorkspaceTab(workspace, "shell", 1);
      setTabs([tab]);
      registerTab(tab.id);
      projects.acceptProject(workspace);
    }
    await Promise.all([agentDetection, environment.refreshShellProfiles(version)]);
  } catch (error) {
    if (version === requestVersion.current) setFailure(toAppFailure(error));
  } finally {
    if (version === requestVersion.current) {
      setOpening(false);
      setReadyToPersist(true);
    }
  }
}
