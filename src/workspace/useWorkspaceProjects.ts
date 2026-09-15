import { useCallback, useState } from "react";
import { closeTerminalTab } from "../terminal/api";
import { openProject } from "./api";
import type { ProjectWorkspace, RecentProject } from "./contracts";
import { toAppFailure } from "./errors";
import { pathKey } from "./path";
import { configureNewProjectTab } from "./projects/launch";
import { loadRecentProjects, rememberProject, removeRecentProject as removeRecentEntry, saveRecentProjects } from "./storage";
import { closeTabsForPath, createProjectSwitchTab, createWorkspaceTab } from "./tabs";
import type { NamedWorkspaces } from "./named/useNamedWorkspaces";
import type { WorkspaceState } from "./useWorkspaceState";

interface ProjectOptions { state: WorkspaceState; named: NamedWorkspaces }

export function useWorkspaceProjects({ state, named }: ProjectOptions) {
  const { tabs, setTabs, restoredWorkspace, requestVersion, setOpening, setFailure, setReadyToPersist } = state;
  const { activeTabId, registerTab } = named;
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>(loadRecentProjects);
  const [lastProject, setLastProject] = useState<ProjectWorkspace | null>(() => (
    restoredWorkspace?.tabs.find((tab) => tab.id === restoredWorkspace.activeTabId)?.project
      ?? restoredWorkspace?.tabs[0]?.project ?? null
  ));
  const activeProject = tabs.find((tab) => tab.id === activeTabId)?.project ?? lastProject;
  const acceptProject = useCallback((workspace: ProjectWorkspace) => {
    setLastProject(workspace);
    setRecentProjects((current) => {
      const next = rememberProject(workspace, current);
      saveRecentProjects(next);
      return next;
    });
  }, []);
  // 选项目新建会话，保留当前会话的 cwd、PTY 和滚屏。
  const selectProject = useCallback(async (path: string | null) => {
    const version = ++requestVersion.current;
    setOpening(true);
    setFailure(null);
    try {
      const workspace = await openProject(path);
      if (version !== requestVersion.current) return;
      const tab = configureNewProjectTab(createProjectSwitchTab(tabs, workspace));
      setTabs((current) => [...current, tab]);
      registerTab(tab.id);
      acceptProject(workspace);
    } catch (error) {
      if (version === requestVersion.current) setFailure(toAppFailure(error));
    } finally {
      if (version === requestVersion.current) {
        setOpening(false);
        setReadyToPersist(true);
      }
    }
  }, [acceptProject, registerTab, requestVersion, setFailure, setOpening, setReadyToPersist, setTabs, tabs]);
  const removeRecentProject = useRemoveRecentProject({ state, named, recentProjects, setRecentProjects,
    lastProject, setLastProject, acceptProject });
  return { activeProject, recentProjects, acceptProject, selectProject, removeRecentProject };
}

interface RemoveOptions extends ProjectOptions {
  recentProjects: RecentProject[];
  setRecentProjects: (value: RecentProject[]) => void;
  lastProject: ProjectWorkspace | null;
  setLastProject: (value: ProjectWorkspace | null) => void;
  acceptProject: (value: ProjectWorkspace) => void;
}

function useRemoveRecentProject({ state, named, recentProjects, setRecentProjects,
  lastProject, setLastProject, acceptProject }: RemoveOptions) {
  const { tabs, setTabs, setFailure } = state;
  const { activeTabId, registerTab } = named;
  return useCallback(async (id: string) => {
    const target = recentProjects.find((project) => project.id === id);
    if (!target) return;
    const targetKey = pathKey(target.rootPath);
    try {
      await Promise.all(tabs.filter((tab) => pathKey(tab.project.rootPath) === targetKey)
        .map((tab) => closeTerminalTab(tab.id)));
    } catch (error) { setFailure(toAppFailure(error)); return; }
    const next = removeRecentEntry(recentProjects, id);
    saveRecentProjects(next);
    setRecentProjects(next);
    setTabs((current) => closeTabsForPath(current, activeTabId, target.rootPath).remaining);
    if (lastProject && pathKey(lastProject.rootPath) === targetKey) setLastProject(null);
    if (tabs.some((tab) => pathKey(tab.project.rootPath) !== targetKey) || !next.length) return;
    try {
      const workspace = await openProject(next[0].rootPath);
      const tab = createWorkspaceTab(workspace, "shell", 1);
      setTabs([tab]);
      registerTab(tab.id);
      acceptProject(workspace);
    } catch (error) { setFailure(toAppFailure(error)); }
  }, [acceptProject, activeTabId, lastProject, recentProjects, registerTab, setFailure,
    setLastProject, setRecentProjects, setTabs, tabs]);
}
