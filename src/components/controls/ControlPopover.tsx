import { useLayoutEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ControlPopoverState } from "./useControlPopover";
import "./controls.css";

const INSET = 10;
const GAP = 6;
const DEFAULT_WIDTH = 220;
const MAX_HEIGHT = 320;

export function ControlPopover({ control, children, className = "", width = DEFAULT_WIDTH, maxHeight = MAX_HEIGHT }: {
  control: ControlPopoverState; children: ReactNode; className?: string; width?: number; maxHeight?: number;
}) {
  usePosition(control, width, maxHeight);
  if (!control.open || typeof document === "undefined") return null;
  return createPortal(<div ref={control.panel} className={`ui-popover ${className}`} style={{ visibility: "hidden" }}
    data-control-layer="">{children}</div>, document.body);
}

function usePosition(control: ControlPopoverState, minimumWidth: number, limit: number) {
  const { open, root, panel, close } = control;
  useLayoutEffect(() => {
    if (!open || !root.current || !panel.current) return;
    const anchor = root.current, surface = panel.current;
    const place = () => {
      if (!anchor.getClientRects().length) { close(); return; }
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, minimumWidth), window.innerWidth - INSET * 2);
      const below = Math.max(0, window.innerHeight - rect.bottom - GAP - INSET);
      const above = Math.max(0, rect.top - GAP - INSET);
      const wanted = Math.min(surface.scrollHeight, limit);
      const up = below < wanted && above > below;
      const maxHeight = Math.min(limit, up ? above : below);
      const left = Math.max(INSET, Math.min(rect.left, window.innerWidth - width - INSET));
      const top = up ? Math.max(INSET, rect.top - GAP - Math.min(wanted, maxHeight)) : rect.bottom + GAP;
      // 在子控件的聚焦 effect 之前同步显现，WebKit 不会聚焦 visibility:hidden 的日历。
      Object.assign(surface.style, { width: `${width}px`, maxHeight: `${maxHeight}px`, left: `${left}px`, top: `${top}px`, visibility: "visible" });
    };
    const scroll = (event: Event) => { if (!surface.contains(event.target as Node)) place(); };
    const resize = new ResizeObserver(place);
    const visible = new IntersectionObserver(([entry]) => { if (!entry.isIntersecting) close(); });
    visible.observe(anchor);
    resize.observe(anchor); resize.observe(surface); place();
    window.addEventListener("resize", place); window.addEventListener("scroll", scroll, true);
    return () => { resize.disconnect(); visible.disconnect(); window.removeEventListener("resize", place); window.removeEventListener("scroll", scroll, true); };
  }, [open, root, panel, minimumWidth, limit, close]);
}
