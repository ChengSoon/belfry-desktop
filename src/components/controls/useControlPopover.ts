import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { focusAdjacent, isTopLayer, ownsTarget, registerLayer, shouldDismissOnBlur } from "./layerOwnership";

export interface ControlPopoverState {
  id: string; open: boolean;
  root: RefObject<HTMLDivElement | null>; panel: RefObject<HTMLDivElement | null>;
  trigger: RefObject<HTMLElement | null>;
  close: (focus?: boolean) => void;
}

export function useControlPopover<T extends HTMLElement = HTMLButtonElement>(initialOpen = false) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null), trigger = useRef<T>(null);
  const [open, setOpen] = useState(initialOpen);
  const close = useCallback((focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const state = { id, open, root, panel, trigger, close };
  usePopoverDismiss(state);
  const onBlur = (event: FocusEvent) => {
    if (shouldDismissOnBlur(root.current, event.relatedTarget as Node | null)) close();
  };
  const onTab = (event: ReactKeyboardEvent) => {
    if (event.key !== "Tab" || !panel.current?.contains(event.currentTarget)) return false;
    event.preventDefault(); close(); focusAdjacent(trigger.current, event.shiftKey ? -1 : 1); return true;
  };
  return { ...state, setOpen, onBlur, onTab, toggle: () => setOpen((current) => !current) };
}

function usePopoverDismiss({ open, root, panel, trigger, close }: ControlPopoverState) {
  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) return;
    return registerLayer({ anchor: root.current, panel: panel.current });
  }, [open, root, panel]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!ownsTarget(root.current, event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.defaultPrevented || !isTopLayer(panel.current)) return;
      event.preventDefault(); event.stopPropagation(); close(true);
    };
    // 捕获内层 Esc，阻止外层模态框和终端快捷键同时响应。
    window.addEventListener("keydown", escape, true);
    document.addEventListener("mousedown", outside);
    return () => {
      window.removeEventListener("keydown", escape, true);
      document.removeEventListener("mousedown", outside);
      if (panel.current?.contains(document.activeElement)) trigger.current?.focus({ preventScroll: true });
    };
  }, [open, root, panel, trigger, close]);
}
