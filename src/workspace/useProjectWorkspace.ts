import { useMemo } from "react";
import { useNamedWorkspaces } from "./named/useNamedWorkspaces";
import { useProjectRepair } from "./named/useProjectRepair";
import { useWorkspaceBootstrap } from "./useWorkspaceBootstrap";
import { useWorkspaceEnvironment } from "./useWorkspaceEnvironment";
import { useWorkspaceHistory } from "./useWorkspaceHistory";
import { useWorkspaceLaunch } from "./useWorkspaceLaunch";
import { useWorkspacePersistence } from "./useWorkspacePersistence";
import { useWorkspaceProjects } from "./useWorkspaceProjects";
import { useWorkspaceState } from "./useWorkspaceState";
import { useWorkspaceTabActions } from "./useWorkspaceTabActions";

/** 对外 API 不变；启动、存档与会话动作各自维护生命周期。 */
export function useProjectWorkspace() {
  const state = useWorkspaceState();
  const { tabs, restoredWorkspace } = state;
  const named = useNamedWorkspaces({ tabIds: tabs.map((tab) => tab.id),
    activeTabId: restoredWorkspace?.activeTabId ?? null });
  const { activeTabId, setActiveTabId, registerTab } = named;
  const visibleTabs = useMemo(() => tabs.filter((tab) => named.current.tabIds.includes(tab.id)),
    [named.current.tabIds, tabs]);
  const repairProject = useProjectRepair(tabs, state.setTabs);
  const projects = useWorkspaceProjects({ state, named });
  const environment = useWorkspaceEnvironment(state.requestVersion);
  const options = { state, projects, environment, registerTab };
  useWorkspaceBootstrap(options);
  const persistence = useWorkspacePersistence({ tabs, activeTabId, ready: state.readyToPersist });
  const launches = useWorkspaceLaunch(options);
  const launchHistorySession = useWorkspaceHistory(options);
  const actions = useWorkspaceTabActions(state);
  return {
    named, visibleTabs, repairProject, ...persistence,
    activeProject: projects.activeProject,
    agents: environment.agents,
    shellProfiles: environment.shellProfiles,
    tabs, activeTabId,
    recentProjects: projects.recentProjects,
    failure: state.failure,
    opening: state.opening,
    selectProject: projects.selectProject,
    ...launches,
    launchHistorySession,
    ...actions,
    removeRecentProject: projects.removeRecentProject,
    redetectAgents: environment.redetectAgents,
    setActiveTabId,
    dismissFailure: () => state.setFailure(null),
  };
}
