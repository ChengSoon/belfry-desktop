import { useLayoutEffect, useRef } from "react";
import { ownsTarget } from "../components/controls/layerOwnership";
import { useMotionActive } from "../components/motion/Presence";

/** 浮层通用退出手势：点击外部或 Escape 关闭。退出动画不再占用监听器。 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void) {
  const active = useMotionActive();
  const ref = useRef<T>(null);
  const latest = useRef(close);
  latest.current = close;

  useLayoutEffect(() => {
    if (!open || !active) return;
    // Clicking the opener should be handled by its toggle, not close on
    // mousedown and immediately reopen on click (notably the collab toolbar).
    const opener = document.activeElement;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (opener instanceof HTMLElement && opener !== document.body && opener.contains(target)) return;
      if (!ownsTarget(ref.current, target)) latest.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) latest.current();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, active]);

  return ref;
}
