import { useCallback, useMemo, useState } from "react";
import { buildQuickOpenItems } from "./items";
import type { QuickOpenItem } from "./model";
import type { RecentProject, WorkspaceTab } from "../workspace/contracts";

interface QuickOpenActions {
  tabs: readonly WorkspaceTab[];
  recentProjects: readonly RecentProject[];
  activeTabId: string | null;
  activateTab: (id: string) => void;
  selectProject: (path: string) => Promise<void>;
}

/** Quick Open 的状态、条目快照和动作分发，避免把浮层细节塞进 App 总入口。 */
export function useQuickOpen(actions: QuickOpenActions) {
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => buildQuickOpenItems(actions.tabs, actions.recentProjects, actions.activeTabId),
    [actions.activeTabId, actions.recentProjects, actions.tabs],
  );
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  const select = useCallback((item: QuickOpenItem, onAction: (id: string) => void) => {
    setOpen(false);
    if (item.kind === "session" && item.value) {
      actions.activateTab(item.value);
      return;
    }
    if (item.kind === "project" && item.value) {
      void actions.selectProject(item.value);
      return;
    }
    onAction(item.id);
  }, [actions]);

  return { close, items, open, select, toggle };
}
