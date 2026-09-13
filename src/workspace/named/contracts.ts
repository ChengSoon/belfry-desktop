import type { LayoutNode } from "../../layout/contracts";

export interface NamedWorkspace {
  id: string;
  name: string;
  tabIds: string[];
  activeTabId: string | null;
  layout: LayoutNode | null;
}

export interface WorkspaceCollection {
  version: 1;
  activeWorkspaceId: string;
  workspaces: NamedWorkspace[];
}

export interface WorkspaceSeed {
  tabIds: string[];
  activeTabId: string | null;
}

export interface CollectionLoad {
  collection: WorkspaceCollection;
  raw: string | null;
  notices: string[];
  error: string | null;
}

export const NAMED_WORKSPACES_KEY = "belfry.named-workspaces.v1";
export const NAMED_RECOVERY_KEY = "belfry.named-workspaces.recovery.v1";
export const MAX_WORKSPACES = 32;
export const MAX_WORKSPACE_NAME = 64;
export const MAX_COLLECTION_TABS = 2048;
export const MAX_LAYOUT_DEPTH = 16;
export const MAX_COLLECTION_BYTES = 1024 * 1024;
