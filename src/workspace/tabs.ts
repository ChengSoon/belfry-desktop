import type { ProjectWorkspace, WorkspaceTab, WorkspaceTabKind } from "./contracts";

export interface ProjectGroup {
  project: ProjectWorkspace;
  tabs: WorkspaceTab[];
}

export function createWorkspaceTab(
  project: ProjectWorkspace,
  kind: WorkspaceTabKind,
  ordinal: number,
): WorkspaceTab {
  return {
    id: crypto.randomUUID(),
    project,
    kind,
    title: tabTitle(kind, ordinal),
    profileId: kind === "shell" ? "system-default" : `agent:${kind}`,
    phase: "idle",
    error: null,
  };
}

export function nextActiveTab(tabs: WorkspaceTab[], closingId: string) {
  const closingIndex = tabs.findIndex((tab) => tab.id === closingId);
  const remaining = tabs.filter((tab) => tab.id !== closingId);
  const nextIndex = Math.min(Math.max(closingIndex, 0), remaining.length - 1);
  return { remaining, activeId: remaining[nextIndex]?.id ?? null };
}

/** 侧栏分组：按项目首次出现的顺序排列，组内保持会话原有顺序。 */
export function groupTabsByProject(tabs: WorkspaceTab[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const tab of tabs) {
    const group = groups.get(tab.project.id);
    if (group) group.tabs.push(tab);
    else groups.set(tab.project.id, { project: tab.project, tabs: [tab] });
  }
  return [...groups.values()];
}

/** 序号按 kind 全局递增，不按项目重置——否则两个项目组里会同时出现 Shell 01。 */
export function nextOrdinal(tabs: WorkspaceTab[], kind: WorkspaceTabKind) {
  return tabs.filter((tab) => tab.kind === kind).length + 1;
}

function tabTitle(kind: WorkspaceTabKind, ordinal: number) {
  const label = { shell: "Shell", codex: "Codex", claude: "Claude" }[kind];
  return `${label} ${String(ordinal).padStart(2, "0")}`;
}
