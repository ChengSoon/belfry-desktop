import { layoutTabIds, pruneLayout } from "../../layout/tree";
import type { NamedWorkspace, WorkspaceCollection, WorkspaceSeed } from "./contracts";

export function initialCollection(seed: WorkspaceSeed): WorkspaceCollection {
  const workspace: NamedWorkspace = {
    id: "default", name: "默认工作区", tabIds: seed.tabIds,
    activeTabId: seed.tabIds.includes(seed.activeTabId ?? "") ? seed.activeTabId : seed.tabIds[0] ?? null,
    layout: null,
  };
  return { version: 1, activeWorkspaceId: workspace.id, workspaces: [workspace] };
}

export function currentWorkspace(collection: WorkspaceCollection) {
  return collection.workspaces.find((item) => item.id === collection.activeWorkspaceId) ?? collection.workspaces[0];
}

export function reconcileCollection(collection: WorkspaceCollection, tabIds: string[]) {
  const alive = new Set(tabIds);
  const claimed = new Set(collection.workspaces.flatMap((item) => item.tabIds));
  const unclaimed = tabIds.filter((id) => !claimed.has(id));
  const notices: string[] = [];
  const activeId = currentWorkspace(collection).id;
  const workspaces = collection.workspaces.map((item) => {
    const retained = item.tabIds.filter((id) => alive.has(id));
    const missing = item.tabIds.length - retained.length;
    if (missing) notices.push(`${item.name}：${missing} 条会话已不存在，已整理布局。`);
    const nextIds = item.id === activeId ? [...retained, ...unclaimed] : retained;
    const normalized = normalizeWorkspace(item, nextIds);
    if (item.activeTabId && normalized.activeTabId !== item.activeTabId) {
      notices.push(`${item.name}：活动会话不可用，已恢复到可用窗格。`);
    }
    return normalized;
  });
  if (unclaimed.length) notices.push(`${unclaimed.length} 条未分组会话已放入「${currentWorkspace(collection).name}」。`);
  const changed = workspaces.some((item, index) => item !== collection.workspaces[index]);
  return { collection: changed ? { ...collection, workspaces } : collection, notices };
}

export function normalizeWorkspace(workspace: NamedWorkspace, tabIds: string[]): NamedWorkspace {
  const tree = workspace.layout ? pruneLayout(workspace.layout, new Set(tabIds)) : null;
  const panes = tree ? layoutTabIds(tree) : [];
  const eligible = panes.length ? panes : tabIds;
  const activeTabId = eligible.includes(workspace.activeTabId ?? "")
    ? workspace.activeTabId : eligible[0] ?? null;
  const layout = tree?.kind === "split" ? tree : null;
  const sameIds = tabIds.length === workspace.tabIds.length && tabIds.every((id, index) => id === workspace.tabIds[index]);
  if (sameIds && layout === workspace.layout && activeTabId === workspace.activeTabId) return workspace;
  return { ...workspace, tabIds: sameIds ? workspace.tabIds : tabIds, activeTabId, layout };
}

export function updateWorkspace(collection: WorkspaceCollection, next: NamedWorkspace) {
  if (collection.workspaces.find((item) => item.id === next.id) === next) return collection;
  return { ...collection, workspaces: collection.workspaces.map((item) => item.id === next.id ? next : item) };
}
