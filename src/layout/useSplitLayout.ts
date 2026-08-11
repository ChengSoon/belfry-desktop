import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceTab } from "../workspace/contracts";
import type { DropEdge, LayoutFrame, LayoutNode } from "./contracts";
import { computeFrames, hasTab, layoutTabIds, leaf, pruneLayout, removeLeaf, setRatio, splitLeaf } from "./tree";

/**
 * 分屏状态。root 为 null = 没分屏，画面跟着 activeTabId 走单窗格——
 * 这样没用过拖拽的用户，切会话的行为和分屏功能上线前一模一样。
 * 一旦分屏，root 接管；塌缩回单窗格时又交还给 activeTabId。
 */
export function useSplitLayout(
  tabs: WorkspaceTab[],
  activeTabId: string | null,
  setActiveTabId: (id: string) => void,
) {
  const [root, setRoot] = useState<LayoutNode | null>(null);
  // 同步 effect 要读活动会话，但不该因为它变化就重跑。
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;
  // updater 必须是纯的（StrictMode 下会跑两次），所以新树一律在 updater 外面算出来。
  const rootRef = useRef<LayoutNode | null>(null);
  rootRef.current = root;

  const commit = useCallback((next: LayoutNode | null, focus?: string | null) => {
    rootRef.current = next;
    setRoot(next);
    if (focus) setActiveTabId(focus);
  }, [setActiveTabId]);

  // 会话被关掉后从分屏里剔掉；剔到只剩一个就退回跟随模式，并把焦点交给它，
  // 否则 workspace 自己选的下一个活动会话会和画面上剩的那个不是同一条。
  useEffect(() => {
    const current = rootRef.current;
    if (!current) return;
    const pruned = pruneLayout(current, new Set(tabs.map((tab) => tab.id)));
    const ids = pruned ? layoutTabIds(pruned) : [];
    if (ids.length > 1) {
      if (pruned !== current) commit(pruned);
      return;
    }
    commit(null, ids.length === 1 && ids[0] !== activeRef.current ? ids[0] : null);
  }, [commit, tabs]);

  const frame: LayoutFrame = useMemo(() => {
    const node = root ?? (activeTabId ? leaf(activeTabId) : null);
    return node ? computeFrames(node) : { panes: [], dividers: [] };
  }, [activeTabId, root]);

  const rects = useMemo(
    () => new Map(frame.panes.map((pane) => [pane.tabId, pane.rect])),
    [frame.panes],
  );

  /**
   * 点侧栏切会话：已经在分屏里就只挪焦点，不在就顶掉当前焦点窗格。
   * 未分屏时纯粹是换 activeTabId，走的还是老路径。
   */
  const activateTab = useCallback((id: string) => {
    const current = rootRef.current;
    const focused = activeRef.current;
    if (current && !hasTab(current, id) && focused) {
      commit(splitLeaf(current, focused, id, "center"), id);
      return;
    }
    commit(current, id);
  }, [commit]);

  /** 落下拖拽：在目标窗格的某条边上劈开，落下的那个会话拿到焦点。 */
  const dropTab = useCallback((tabId: string, targetTabId: string, edge: DropEdge) => {
    const current = rootRef.current;
    const base = current ?? (activeRef.current ? leaf(activeRef.current) : null);
    // 单窗格里往边上拖同一个会话，等于要求它和自己分屏，没有意义。
    if (!base || (edge === "center" && tabId === targetTabId)) {
      commit(current, tabId);
      return;
    }
    const next = splitLeaf(base, targetTabId, tabId, edge);
    commit(layoutTabIds(next).length > 1 ? next : null, tabId);
  }, [commit]);

  /** 把窗格从分屏里拿掉，会话本身还活着（PTY 不动，侧栏里照旧）。 */
  const closePane = useCallback((tabId: string) => {
    const current = rootRef.current;
    if (!current) return;
    const next = removeLeaf(current, tabId);
    const ids = next ? layoutTabIds(next) : [];
    if (ids.length > 1) {
      commit(next, tabId === activeRef.current ? ids[0] : null);
      return;
    }
    commit(null, ids.length === 1 ? ids[0] : null);
  }, [commit]);

  const resizeSplit = useCallback((path: string, ratio: number) => {
    const current = rootRef.current;
    if (current) commit(setRatio(current, path, ratio));
  }, [commit]);

  return {
    dividers: frame.dividers,
    panes: frame.panes,
    rects,
    split: frame.panes.length > 1,
    activateTab,
    closePane,
    dropTab,
    resizeSplit,
  };
}
