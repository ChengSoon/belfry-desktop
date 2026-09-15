import { useCallback, useState } from "react";
import type { LayoutNode } from "../../layout/contracts";
import { activateWorkspaceTab, changeWorkspaceLayout, createNamedWorkspace, moveWorkspaceTab,
  registerWorkspaceTab, renameNamedWorkspace, switchNamedWorkspace } from "./actions";
import type { WorkspaceCollection, WorkspaceSeed } from "./contracts";
import { currentWorkspace } from "./model";
import { message } from "./storage";
import { useCollectionPersistence } from "./useCollectionPersistence";
import { useCollectionState } from "./useCollectionState";

export function useNamedWorkspaces(seed: WorkspaceSeed) {
  const port = useCollectionState(seed);
  const { snapshot, ref, commit } = port;
  const persistence = useCollectionPersistence(port, seed);
  const [actionError, setActionError] = useState<string | null>(null);
  const perform = useCallback((change: (value: WorkspaceCollection) => WorkspaceCollection) => {
    try {
      const collection = change(ref.current.collection);
      if (collection !== ref.current.collection) commit({ ...ref.current, collection });
      setActionError(null);
      return null;
    } catch (error) { const reason = message(error); setActionError(reason); return reason; }
  }, [commit, ref]);
  const current = currentWorkspace(snapshot.collection);
  const setActiveTabId = useCallback((id: string | null) => {
    perform((value) => activateWorkspaceTab(value, id));
  }, [perform]);
  const setLayout = useCallback((layout: LayoutNode | null, focus?: string | null) => {
    perform((value) => changeWorkspaceLayout(value, { workspaceId: current.id, layout, focus }));
  }, [current.id, perform]);
  const registerTab = useCallback((tabId: string, activate = true) => {
    perform((value) => registerWorkspaceTab(value, { workspaceId: current.id, tabId, activate }));
  }, [current.id, perform]);
  return {
    ...snapshot, ...persistence, current, actionError, setActiveTabId, setLayout, registerTab,
    activeTabId: current.activeTabId,
    select: (id: string) => perform((value) => switchNamedWorkspace(value, id)),
    create: (name: string) => {
      const id = crypto.randomUUID();
      return perform((value) => createNamedWorkspace(value, { id, name }));
    },
    rename: (name: string) => perform((value) => renameNamedWorkspace(value, { id: current.id, name })),
    move: (tabId: string, workspaceId: string) => perform((value) => moveWorkspaceTab(value, { tabId, workspaceId })),
    dismissNotices: () => commit({ ...ref.current, notices: [] }),
  };
}

export type NamedWorkspaces = ReturnType<typeof useNamedWorkspaces>;
