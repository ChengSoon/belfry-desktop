import { useLayoutEffect, useRef } from "react";
import { ownsTarget } from "../components/controls/layerOwnership";
import { useMotionActive } from "../components/motion/Presence";

/** 浮层通用退出手势：点击外部或 Escape 关闭。退出动画不再占用监听器。 */
export function useDismiss<T extends HTMLElement>(open: boolean, close: () => void,
  outsideEvent: "mousedown" | "click" = "mousedown") {
  const active = useMotionActive();
  const ref = useRef<T>(null);
  const latest = useRef(close);
  latest.current = close;

  useLayoutEffect(() => {
    if (!open || !active) return;
    // Clicking the opener should be handled by its toggle, not close on
    // mousedown and immediately reopen on click (notably the collab toolbar).
    const opener = document.activeElement;
    const onOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (opener instanceof HTMLElement && opener !== document.body && opener.contains(target)) return;
      if (!ownsTarget(ref.current, target)) latest.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.isComposing) latest.current();
    };
    const attachOutside = () => document.addEventListener(outsideEvent, onOutside);
    // React can commit this effect while the opening click is still bubbling.
    // Do not let a newly opened drawer treat that same event as an outside click.
    const attachTimer = outsideEvent === "click" ? window.setTimeout(attachOutside, 0) : null;
    if (attachTimer === null) attachOutside();
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (attachTimer !== null) window.clearTimeout(attachTimer);
      document.removeEventListener(outsideEvent, onOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, active, outsideEvent]);

  return ref;
}
