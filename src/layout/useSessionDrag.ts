import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { DropTarget, PaneFrame } from "./contracts";
import { hitTestPanes } from "./hitTest";

/** 超过这个位移才算拖拽，否则当点击处理——不然点会话行会被误判成拖。 */
const DRAG_THRESHOLD = 5;

export interface SessionDrag {
  tabId: string;
  pointerX: number;
  pointerY: number;
  target: DropTarget | null;
}

/**
 * 会话拖拽手势：从侧栏行或窗格标题按下，落到某个窗格的某条边上。
 * 走 document 级监听而不是 HTML5 DnD——xterm 的画布会吃掉 dragover，
 * 而落点判定本来就只需要窗格矩形做算术，不依赖 DOM 命中测试。
 */
export function useSessionDrag(
  stageRef: RefObject<HTMLElement | null>,
  panes: readonly PaneFrame[],
  onDrop: (tabId: string, targetTabId: string, edge: DropTarget["edge"]) => void,
) {
  const [drag, setDrag] = useState<SessionDrag | null>(null);
  // 手势期间这些值都会变，但监听只在按下时装一次，用 ref 取最新的。
  const panesRef = useRef(panes);
  const dropRef = useRef(onDrop);
  const origin = useRef<{ x: number; y: number; tabId: string } | null>(null);
  const moved = useRef(false);
  panesRef.current = panes;
  dropRef.current = onDrop;

  useEffect(() => {
    if (!drag) return;
    document.body.classList.add("is-dragging-session");
    return () => document.body.classList.remove("is-dragging-session");
  }, [drag]);

  const startDrag = useCallback((tabId: string, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    origin.current = { x: event.clientX, y: event.clientY, tabId };
    moved.current = false;

    const onMove = (move: PointerEvent) => {
      const start = origin.current;
      if (!start) return;
      const far = Math.hypot(move.clientX - start.x, move.clientY - start.y) >= DRAG_THRESHOLD;
      if (!far && !moved.current) return;
      moved.current = true;
      // 拖拽中禁掉文本选中，否则指针扫过 xterm 会拖出一片反白。
      move.preventDefault();
      const stage = stageRef.current?.getBoundingClientRect() ?? null;
      const target = stage
        ? hitTestPanes(panesRef.current, stage, move.clientX, move.clientY)
        : null;
      setDrag({ tabId: start.tabId, pointerX: move.clientX, pointerY: move.clientY, target });
    };

    const onUp = (up: PointerEvent) => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      const start = origin.current;
      origin.current = null;
      setDrag(null);
      if (!start || !moved.current) return;
      const stage = stageRef.current?.getBoundingClientRect() ?? null;
      const target = stage ? hitTestPanes(panesRef.current, stage, up.clientX, up.clientY) : null;
      if (target) dropRef.current(start.tabId, target.tabId, target.edge);
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
  }, [stageRef]);

  /** 拖完那一下 pointerup 还会带出一次 click，会话行得认出来别当成切换。 */
  const consumedClick = useCallback(() => {
    if (!moved.current) return false;
    moved.current = false;
    return true;
  }, []);

  return { drag, startDrag, consumedClick };
}
