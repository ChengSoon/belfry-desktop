import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ownsTarget } from "./controls/layerOwnership";

/** 小型非模态浮层：键盘打开即聚焦，Esc 回到入口，外部点击保持原点击目标。 */
export function useFlyout() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>("[data-flyout-focus]")?.focus();
    const outside = (event: MouseEvent) => {
      if (!ownsTarget(root.current, event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault(); close(); trigger.current?.focus();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [close, open]);
  return { open, root, trigger, id, close, toggle: () => setOpen((value) => !value) };
}
