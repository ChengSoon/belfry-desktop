import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function usePopover(height = 220, initialOpen = false) {
  const [open, setOpen] = useState(initialOpen), [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  // Portal 浮层不在锚点 DOM 内，点击判断需要同时包含两者。
  const panel = useRef<HTMLElement | null>(null);
  const setPanel = useCallback((node: HTMLElement | null) => { panel.current = node; }, []);
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      !!target && (!!ref.current?.contains(target as Node) || !!panel.current?.contains(target as Node));
    const outside = (event: MouseEvent) => { if (!inside(event.target)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (open && ref.current) setUp(window.innerHeight - ref.current.getBoundingClientRect().bottom < height);
  }, [open, height]);
  return { open, setOpen, up, ref, setPanel };
}
