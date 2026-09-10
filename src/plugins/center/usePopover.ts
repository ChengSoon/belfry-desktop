import { useEffect, useLayoutEffect, useRef, useState } from "react";

export function usePopover(height = 220) {
  const [open, setOpen] = useState(false), [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (open && ref.current) setUp(window.innerHeight - ref.current.getBoundingClientRect().bottom < height);
  }, [open, height]);
  return { open, setOpen, up, ref };
}
