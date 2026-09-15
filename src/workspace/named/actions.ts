import type { LayoutNode } from "../../layout/contracts";
import { hasTab, layoutTabIds, replaceLeaf } from "../../layout/tree";
import { MAX_WORKSPACES, type WorkspaceCollection } from "./contracts";
import { currentWorkspace, normalizeWorkspace, updateWorkspace } from "./model";
import { isId, parseLayout, workspaceName } from "./validation";

export function switchNamedWorkspace(collection: WorkspaceCollection, id: string) {
  if (!collection.workspaces.some((item) => item.id === id)) throw new Error("工作区已不存在");
  return collection.activeWorkspaceId === id ? collection : { ...collection, activeWorkspaceId: id };
}

export function activateWorkspaceTab(collection: WorkspaceCollection, id: string | null): WorkspaceCollection {
  if (id === null) return collection;
  if (!isId(id)) throw new Error("会话 ID 无效");
  const owner = collection.workspaces.find((item) => item.tabIds.includes(id));
  if (!owner) return collection;
  let layout = owner.layout;
  if (layout && !hasTab(layout, id)) {
    const focused = owner.activeTabId ?? layoutTabIds(layout)[0];
    layout = replaceLeaf(layout, focused, id);
  }
  const tabIds = owner.tabIds.includes(id) ? owner.tabIds : [...owner.tabIds, id];
  const next = owner.activeTabId === id && layout === owner.layout && tabIds === owner.tabIds
    ? owner : { ...owner, activeTabId: id, tabIds, layout };
  return switchNamedWorkspace(updateWorkspace(collection, next), owner.id);
}

export function registerWorkspaceTab(collection: WorkspaceCollection, request: {
  workspaceId: string; tabId: string; activate: boolean;
}) {
  if (!isId(request.tabId)) throw new Error("会话 ID 无效");
  if (collection.workspaces.some((item) => item.tabIds.includes(request.tabId))) return collection;
  const owner = collection.workspaces.find((item) => item.id === request.workspaceId);
  if (!owner) throw new Error("会话发起工作区已不存在");
  const added = updateWorkspace(collection, { ...owner, tabIds: [...owner.tabIds, request.tabId] });
  return request.activate && collection.activeWorkspaceId === owner.id ? activateWorkspaceTab(added, request.tabId) : added;
}

export function createNamedWorkspace(collection: WorkspaceCollection, request: { id: string; name: string }) {
  if (collection.workspaces.length >= MAX_WORKSPACES) throw new Error(`最多保存 ${MAX_WORKSPACES} 个工作区`);
  if (!isId(request.id) || collection.workspaces.some((item) => item.id === request.id)) throw new Error("工作区 ID 无效或重复");
  const name = uniqueName(collection, request);
  return { ...collection, activeWorkspaceId: request.id,
    workspaces: [...collection.workspaces, { id: request.id, name, tabIds: [], activeTabId: null, layout: null }] };
}

export function renameNamedWorkspace(collection: WorkspaceCollection, request: { id: string; name: string }) {
  const workspace = collection.workspaces.find((item) => item.id === request.id);
  if (!workspace) throw new Error("工作区已不存在");
  const name = uniqueName(collection, request);
  return name === workspace.name ? collection : updateWorkspace(collection, { ...workspace, name });
}

export function moveWorkspaceTab(collection: WorkspaceCollection, request: { tabId: string; workspaceId: string }) {
  const source = collection.workspaces.find((item) => item.tabIds.includes(request.tabId));
  const destination = collection.workspaces.find((item) => item.id === request.workspaceId);
  if (!source || !destination) throw new Error("会话或目标工作区已不存在");
  if (source.id === destination.id) return collection;
  const removed = updateWorkspace(collection, normalizeWorkspace(source, source.tabIds.filter((id) => id !== request.tabId)));
  const added = updateWorkspace(removed, { ...destination, tabIds: [...destination.tabIds, request.tabId] });
  return activateWorkspaceTab(added, request.tabId);
}

export function changeWorkspaceLayout(collection: WorkspaceCollection, request: {
  workspaceId: string; layout: LayoutNode | null; focus?: string | null;
}) {
  if (collection.activeWorkspaceId !== request.workspaceId) return collection;
  const workspace = currentWorkspace(collection);
  parseLayout(request.layout, new Set(workspace.tabIds));
  const candidate = { ...workspace, layout: request.layout, activeTabId: request.focus ?? workspace.activeTabId };
  const next = normalizeWorkspace(candidate, workspace.tabIds);
  return updateWorkspace(collection, next);
}

function uniqueName(collection: WorkspaceCollection, request: { id: string; name: string }) {
  const name = workspaceName(request.name);
  if (collection.workspaces.some((item) => item.id !== request.id && item.name.toLowerCase() === name.toLowerCase())) {
    throw new Error("已有同名工作区，请换一个名称");
  }
  return name;
}
