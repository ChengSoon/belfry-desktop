import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DropRegion, DropTarget, PaneFrame } from "./contracts";
import { resolveDropRegion } from "./hitTest";

/** 超过这个位移才算拖拽，否则当点击处理——不然点会话行会被误判成拖。 */
const DRAG_THRESHOLD = 5;

export interface SessionDrag {
  tabId: string;
  pointerX: number;
  pointerY: number;
  target: DropRegion | null;
}

interface SessionDragHandlers {
  /** 落在窗格上：在目标窗格的某条边劈开。 */
  onDrop: (tabId: string, targetTabId: string, edge: DropTarget["edge"]) => void;
  /** 落回侧栏：把这个会话从分屏里摘出去，会话本身留着。 */
  onEject: (tabId: string) => void;
  /** 这个会话现在摘得动吗——摘不动时侧栏不作为落区，也就不给可落下的高亮。 */
  canEject: (tabId: string) => boolean;
}

/**
 * 会话拖拽手势：从侧栏行或窗格标题按下，落到某个窗格的某条边上，或者拖回侧栏摘出去。
 * 走 document 级监听而不是 HTML5 DnD——xterm 的画布会吃掉 dragover，
 * 而落点判定本来就只需要窗格矩形做算术，不依赖 DOM 命中测试。
 */
export function useSessionDrag(
  stageRef: RefObject<HTMLElement | null>,
  sidebarRef: RefObject<HTMLElement | null>,
  panes: readonly PaneFrame[],
  handlers: SessionDragHandlers,
) {
  const [drag, setDrag] = useState<SessionDrag | null>(null);
  // 手势期间这些值都会变，但监听只在按下时装一次，用 ref 取最新的。
  const panesRef = useRef(panes);
  const handlersRef = useRef(handlers);
  const origin = useRef<{ x: number; y: number; tabId: string; fromSidebar: boolean } | null>(null);
  const moved = useRef(false);
  panesRef.current = panes;
  handlersRef.current = handlers;

  useEffect(() => {
    if (!drag) return;
    document.body.classList.add("is-dragging-session");
    return () => document.body.classList.remove("is-dragging-session");
  }, [drag]);

  const sidebarBox = useCallback(
    () => sidebarRef.current?.getBoundingClientRect() ?? null,
    [sidebarRef],
  );

  /** 侧栏收起时 sidebarRef 是空的，落区自然就只剩窗格。 */
  const regionAt = useCallback((clientX: number, clientY: number) => {
    const start = origin.current;
    const stage = stageRef.current?.getBoundingClientRect() ?? null;
    if (!start || !stage) return null;
    // 手势起于侧栏又落回侧栏 = 什么都没发生。不这样兜住的话，
    // 想点会话却手抖超过 5px，就会把它从分屏里摘掉。
    const ejectable = !start.fromSidebar && handlersRef.current.canEject(start.tabId);
    return resolveDropRegion(panesRef.current, stage, sidebarBox(), clientX, clientY, ejectable);
  }, [sidebarBox, stageRef]);

  const startDrag = useCallback((tabId: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    const sidebar = sidebarBox();
    const fromSidebar = sidebar
      ? event.clientX >= sidebar.left && event.clientX <= sidebar.left + sidebar.width
      : false;
    origin.current = { x: event.clientX, y: event.clientY, tabId, fromSidebar };
    moved.current = false;

    const onMove = (move: PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      const far = Math.hypot(move.clientX - start.x, move.clientY - start.y) >= DRAG_THRESHOLD;
      if (!far && !moved.current) return;
      moved.current = true;
      // 拖拽中禁掉文本选中，否则指针扫过 xterm 会拖出一片反白。
      move.preventDefault();
      const target = regionAt(move.clientX, move.clientY);
      setDrag({ tabId: start.tabId, pointerX: move.clientX, pointerY: move.clientY, target });
    };

    const onUp = (up: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      const start = origin.current;
      const target = moved.current ? regionAt(up.clientX, up.clientY) : null;
      origin.current = null;
      setDrag(null);
      if (!start || !target) return;
      if (target.kind === "sidebar") handlersRef.current.onEject(start.tabId);
      else handlersRef.current.onDrop(start.tabId, target.tabId, target.edge);
    };

    const onCancel = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      origin.current = null;
      moved.current = false;
      setDrag(null);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }, [regionAt, sidebarBox]);

  /** 拖完那一下 pointerup 还会带出一次 click，会话行得认出来别当成切换。 */
  const consumedClick = useCallback(() => {
    if (!moved.current) return false;
    moved.current = false;
    return true;
  }, []);

  return { drag, startDrag, consumedClick };
}
