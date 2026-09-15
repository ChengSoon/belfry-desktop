import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { NAMED_WORKSPACES_KEY } from "../named/contracts";
import { PROJECT_CATALOG_KEY } from "../projects/contracts";
import { serializeWorkspaceState, WORKSPACE_STATE_KEY } from "../storage";
import { createWorkspaceTab } from "../tabs";
import { useProjectWorkspace } from "../useProjectWorkspace";
import { project, qa } from "./workspaceApi";

if (new URLSearchParams(location.search).has("restored") && !localStorage.getItem(WORKSPACE_STATE_KEY)) {
  const a = { ...createWorkspaceTab(project("/qa/a"), "shell", 1), id: "saved-a",
    daemonSessionId: "01arz3ndektsv4rrffq69g5fav" };
  const b = { ...createWorkspaceTab(project("/qa/b"), "codex", 1, "saved-codex-session"), id: "saved-b" };
  localStorage.setItem(WORKSPACE_STATE_KEY, serializeWorkspaceState([a, b], a.id));
  localStorage.setItem(NAMED_WORKSPACES_KEY, JSON.stringify({ version: 1, activeWorkspaceId: "space-a",
    workspaces: [{ id: "space-a", name: "A", tabIds: [a.id], activeTabId: a.id, layout: null },
      { id: "space-b", name: "B", tabIds: [b.id], activeTabId: b.id, layout: null }] }));
  localStorage.setItem(PROJECT_CATALOG_KEY, JSON.stringify({ version: 1, entries: [{ id: "profile-a",
    project: a.project, favorite: true, group: "QA", shell: "shell:bash", command: "echo run-once", env: { QA: "1" } }] }));
}

function Workspace() {
  const workspace = useProjectWorkspace();
  useEffect(() => { Object.assign(qa, { workspace }); });
  return <><button id="launch-shell" onClick={() => void workspace.launch("shell")} type="button">新建 Shell</button>
    <output id="workspace-state">{JSON.stringify({ opening: workspace.opening, activeTabId: workspace.activeTabId,
      activeProject: workspace.activeProject, tabs: workspace.tabs, visibleTabs: workspace.visibleTabs.map((tab) => tab.id),
      failure: workspace.failure, persistenceError: workspace.persistenceError, named: workspace.named.collection })}</output></>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><Workspace /></StrictMode>);
