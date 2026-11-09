import { useLayoutEffect, useRef, useState } from "react";
import { composingKey } from "../../utils/keyboard";

const COMPACT = "(max-height: 600px)";
const OPEN_LAYER = '[data-radix-popper-content-wrapper]:has([data-state="open"], [data-state="delayed-open"], [data-state="instant-open"]), [data-slot=dialog-content]:not([data-state="closed"]), [data-slot=alert-dialog-content]:not([data-state="closed"])';

/** The compact presentation keeps its cards mounted, including unsent drafts. */
export function useAttentionLayout(roomId: string, present: boolean) {
  const panel = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT).matches);
  const [open, setOpen] = useState(false);
  const expanded = compact && open;

  useLayoutEffect(() => {
    const media = window.matchMedia(COMPACT);
    const change = () => {
      // Do not hide the field the user is currently editing at the breakpoint.
      if (media.matches && body.current?.contains(document.activeElement)) setOpen(true);
      setCompact(media.matches);
    };
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useLayoutEffect(() => { setOpen(false); }, [roomId, present]);

  useLayoutEffect(() => {
    if (!compact || !present) return;
    const main = panel.current?.closest("main");
    const content = body.current;
    if (!main || !content) return;
    const composer = main.querySelector<HTMLElement>(".room-composer");
    const measure = () => {
      const bounds = main.getBoundingClientRect();
      const input = composer?.getBoundingClientRect();
      // Keep the composer and at least 80px of conversation below the overlay.
      const bottom = input?.height ? input.top : bounds.bottom;
      // Apply the limit before this resize is painted; React state can leave
      // the previous height in place for a frame while the composer grows.
      content.style.maxHeight = `${Math.max(0, bottom - bounds.top - 8 - 80)}px`;
    };
    const observer = new ResizeObserver(measure);
    observer.observe(main, { box: "border-box" });
    if (composer) observer.observe(composer, { box: "border-box" });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      content.style.removeProperty("max-height");
    };
  }, [compact, present, roomId]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  };

  useLayoutEffect(() => {
    if (!expanded) return;
    if (!body.current?.contains(document.activeElement)) body.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || composingKey(event) || document.querySelector(OPEN_LAYER)) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    const outside = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && !body.current?.contains(target) && !trigger.current?.contains(target)) {
        // Let the original click/Tab place focus and the caret without redirecting it.
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
    };
  }, [expanded]);

  return { panel, body, trigger, compact, expanded, open: () => setOpen(true), close };
}
