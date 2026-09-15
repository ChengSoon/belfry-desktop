import { useCallback, useMemo, useRef } from "react";
import type { WorkspaceTab } from "../workspace/contracts";
import type { DropEdge, LayoutFrame, LayoutNode } from "./contracts";
import { computeFrames, layoutTabIds, leaf, removeLeaf, setRatio, splitLeaf } from "./tree";

interface SplitLayoutOptions {
  tabs: WorkspaceTab[];
  activeTabId: string | null;
  setActiveTabId: (id: string) => void;
  root: LayoutNode | null;
  onChange: (next: LayoutNode | null, focus?: string | null) => void;
}

/**
 * 分屏状态。root 为 null = 没分屏，画面跟着 activeTabId 走单窗格——
 * 这样没用过拖拽的用户，切会话的行为和分屏功能上线前一模一样。
 * 一旦分屏，root 接管；塌缩回单窗格时又交还给 activeTabId。
 */
export function useSplitLayout({ tabs, activeTabId, setActiveTabId, root, onChange }: SplitLayoutOptions) {
  // 事件回调读取最新焦点；布局与焦点由命名工作区一起提交。
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;
  // updater 必须是纯的（StrictMode 下会跑两次），所以新树一律在 updater 外面算出来。
  const rootRef = useRef<LayoutNode | null>(null);
  rootRef.current = root;
  const allowedRef = useRef(new Set<string>());
  allowedRef.current = new Set(tabs.map((tab) => tab.id));

  const commit = useCallback((next: LayoutNode | null, focus?: string | null) => {
    onChange(next, focus);
  }, [onChange]);

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
  const activateTab = setActiveTabId;

  /** 落下拖拽：在目标窗格的某条边上劈开，落下的那个会话拿到焦点。 */
  const dropTab = useCallback((tabId: string, targetTabId: string, edge: DropEdge) => {
    if (!allowedRef.current.has(tabId) || !allowedRef.current.has(targetTabId)) return;
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
    if (!allowedRef.current.has(tabId)) return;
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
