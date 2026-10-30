import { useLayoutEffect, useRef } from "react";
import { focusableControls, isTopLayer, ownsTarget, registerLayer } from "./layerOwnership";
import { useMotionActive } from "../motion/Presence";
import { composingKey } from "../../utils/keyboard";

/** 模态框与内层控件共用层级，只由最上层处理 Esc / Tab。 */
export function useDialog(close: () => void, disabled = false) {
  const active = useMotionActive();
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ close, disabled });
  latest.current = { close, disabled };
  useLayoutEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const unregister = registerLayer({ anchor: previous ?? document.body, panel: root });
    focusableControls(root)[0]?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (!isTopLayer(root) || event.defaultPrevented || composingKey(event)) return;
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!latest.current.disabled) latest.current.close();
      }
      if (event.key !== "Tab") return;
      const items = focusableControls(root), first = items[0], last = items.at(-1);
      if (!ownsTarget(root, document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true); unregister();
      const focused = document.activeElement;
      if (previous?.isConnected && (!focused || focused === document.body || root.contains(focused))) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active]);
  return ref;
}
