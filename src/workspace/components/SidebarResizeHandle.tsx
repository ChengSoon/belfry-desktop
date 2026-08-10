import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, sidebarWidthFromKey } from "../sidebarWidth";

interface SidebarResizeHandleProps {
  width: number;
  onResize: (width: number) => void;
  onCommit: () => void;
  onReset: () => void;
}

export function SidebarResizeHandle({
  width,
  onResize,
  onCommit,
  onReset,
}: SidebarResizeHandleProps) {
  const handlers = useResizeHandle(width, onResize, onCommit);

  return (
    <div
      aria-label="调整侧栏宽度"
      aria-orientation="vertical"
      aria-valuemax={SIDEBAR_WIDTH_MAX}
      aria-valuemin={SIDEBAR_WIDTH_MIN}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      className={`sidebar-resize-handle${handlers.dragging ? " is-dragging" : ""}`}
      onDoubleClick={onReset}
      onKeyDown={handlers.resizeWithKeyboard}
      onPointerCancel={handlers.finishDrag}
      onPointerDown={handlers.startDrag}
      onPointerMove={handlers.resize}
      onPointerUp={handlers.finishDrag}
      role="separator"
      tabIndex={0}
      title="拖动调整侧栏宽度；双击复位"
    />
  );
}

function useResizeHandle(
  width: number,
  onResize: (width: number) => void,
  onCommit: () => void,
) {
  const origin = useRef<{ pointerX: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("is-resizing-sidebar");
    return () => document.body.classList.remove("is-resizing-sidebar");
  }, [dragging]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    origin.current = { pointerX: event.clientX, width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    event.preventDefault();
    onResize(origin.current.width + event.clientX - origin.current.pointerX);
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
    onCommit();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const nextWidth = sidebarWidthFromKey(event.key, width);
    if (nextWidth === null) return;
    event.preventDefault();
    onResize(nextWidth);
    onCommit();
  };

  return { dragging, finishDrag, resize, resizeWithKeyboard, startDrag };
}
