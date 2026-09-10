import { useEffect, useRef } from "react";

export function useModal(close: () => void, disabled = false) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(close), disabledRef = useRef(disabled);
  closeRef.current = close; disabledRef.current = disabled;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const controls = () => [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]') ?? [])].filter((element) => element.offsetParent !== null);
    controls()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (!root || !root.contains(document.activeElement)) return;
      if (event.key === "Escape" && !disabledRef.current) { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = controls(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    root?.addEventListener("keydown", key);
    return () => { root?.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return ref;
}
