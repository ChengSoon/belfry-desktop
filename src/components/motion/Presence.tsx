import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import "./motion.css";

// Keep in sync with --motion-exit. A timer, not animationend, owns removal:
// reduced motion, background tabs and interrupted animations must all settle.
export const EXIT_MS = 180;
const ActiveContext = createContext(true);
export const useMotionActive = () => useContext(ActiveContext);
const query = "(prefers-reduced-motion: reduce)";
const reduced = () => typeof window !== "undefined" && window.matchMedia(query).matches;
function subscribe(changed: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
}
export function useReducedMotion() {
  return useSyncExternalStore(subscribe, reduced, () => false);
}

/** Retain only the last open content during exit, without delaying the action.
 * Context immediately releases focus/dismiss listeners; inert blocks stale clicks.
 * Reopening cancels removal and keeps the same component instance.
 */
export function Presence({ open, children, drawer = false }: {
  open: boolean; children: ReactNode; drawer?: boolean;
}) {
  const parentActive = useMotionActive();
  const active = open && parentActive;
  const [present, setPresent] = useState(active);
  const last = useRef(children);
  const reduce = useReducedMotion();
  useLayoutEffect(() => {
    if (active) { last.current = children; setPresent(true); }
  }, [active, children]);
  useLayoutEffect(() => {
    if (active) return;
    if (reduce) { setPresent(false); return; }
    const timer = window.setTimeout(() => setPresent(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [active, reduce]);
  if (!active && (!present || reduce)) return null;
  const content = active ? children : last.current;
  return <ActiveContext value={active}>{drawer ? (
    <div className="motion-drawer" data-motion-state={active ? "open" : "exit"}
      inert={!active} aria-hidden={!active || undefined}>{content}</div>
  ) : content}</ActiveContext>;
}

export function useMotionState() {
  const active = useMotionActive();
  return { "data-motion-state": active ? "open" : "exit", inert: !active,
    "aria-hidden": !active || undefined } as const;
}
