import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, RefObject } from "react";
import { usePopover } from "./usePopover";

const MENU_WIDTH = 260;
const MENU_HEIGHT = 260;
const VIEWPORT_INSET = 8;
const MENU_GAP = 5;

interface DropdownOptions {
  count: number;
  selected: number;
  disabled?: boolean;
  initialOpen?: boolean;
  select: (index: number) => void;
}

export function useDropdown({ count, selected, disabled, initialOpen, select }: DropdownOptions) {
  const menu = usePopover(MENU_HEIGHT, initialOpen ?? false), id = useId();
  const list = useRef<HTMLDivElement | null>(null), [active, setActive] = useState(Math.max(0, selected));
  const open = menu.open && !disabled && count > 0;
  const close = useCallback(() => menu.setOpen(false), [menu.setOpen]);
  const setList = useCallback((node: HTMLDivElement | null) => { list.current = node; menu.setPanel(node); }, [menu.setPanel]);
  const style = useDropdownPosition({ open, count, anchor: menu.ref, list, close });
  const choose = (index: number) => { if (!disabled && index >= 0 && index < count) select(index); close(); };
  const toggle = () => { setActive(Math.max(0, selected)); menu.setOpen(!open); };
  useEffect(() => { if (disabled || !count) close(); }, [disabled, count, close]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const keydown = (event: KeyboardEvent) => {
    if (disabled || !count) return;
    const next = navigationIndex(event.key, active, count);
    if (next !== undefined) {
      event.preventDefault();
      setActive(!open && event.key.startsWith("Arrow") ? Math.max(0, selected) : next);
      menu.setOpen(true); return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(active); else toggle();
    }
    if (event.key === "Tab") close();
  };
  return { id, open, active, style, ref: menu.ref, setList, setActive, close, choose, toggle, keydown };
}

function navigationIndex(key: string, active: number, count: number) {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return Math.min(count - 1, active + 1);
  if (key === "ArrowUp") return Math.max(0, active - 1);
}

interface PositionOptions {
  open: boolean;
  count: number;
  anchor: RefObject<HTMLDivElement | null>;
  list: RefObject<HTMLDivElement | null>;
  close: () => void;
}

function useDropdownPosition({ open, count, anchor, list, close }: PositionOptions) {
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open || !anchor.current || !list.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth, viewportHeight = window.innerHeight;
    const width = Math.min(Math.max(rect.width, MENU_WIDTH), viewportWidth - VIEWPORT_INSET * 2);
    const below = Math.max(0, viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_INSET);
    const above = Math.max(0, rect.top - MENU_GAP - VIEWPORT_INSET);
    const desired = Math.min(MENU_HEIGHT, list.current.scrollHeight), up = below < desired && above > below;
    const height = Math.min(desired, up ? above : below);
    setStyle({ width, maxHeight: height, visibility: "visible",
      left: Math.max(VIEWPORT_INSET, Math.min(rect.right - width, viewportWidth - width - VIEWPORT_INSET)),
      top: up ? rect.top - MENU_GAP - height : rect.bottom + MENU_GAP });
    // 菜单内部可滚动；锚点所在面板滚动或窗口变化时关闭，避免位置脱离控件。
    const scroll = (event: Event) => {
      if (event.target instanceof Node && list.current?.contains(event.target)) return;
      const current = anchor.current?.getBoundingClientRect();
      // 聚焦触发的滚动通知可能晚于展开；锚点没变时仍保持菜单打开。
      if (current?.x === rect.x && current.y === rect.y) return;
      close();
    };
    const resize = () => { if (window.innerWidth !== viewportWidth || window.innerHeight !== viewportHeight) close(); };
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", resize);
    return () => { window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
  }, [open, count, anchor, list, close]);
  return style;
}
