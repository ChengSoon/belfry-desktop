import { useEffect, useRef } from "react";
import { focusableControls, isTopLayer, ownsTarget, registerLayer } from "./layerOwnership";

/** 模态框与内层控件共用层级，只由最上层处理 Esc / Tab。 */
export function useDialog(close: () => void, disabled = false) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef({ close, disabled });
  latest.current = { close, disabled };
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const unregister = registerLayer({ anchor: previous ?? document.body, panel: root });
    focusableControls(root)[0]?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (!isTopLayer(root) || event.defaultPrevented || event.isComposing) return;
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
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
