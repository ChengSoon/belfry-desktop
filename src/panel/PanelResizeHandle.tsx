import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { panelWidthDelta, panelWidthFromKey, type PanelWidthSpec } from "./panelWidth";
import "./panel.css";

interface PanelResizeHandleProps {
  spec: PanelWidthSpec;
  label: string;
  width: number;
  onResize: (width: number) => void;
  onCommit: () => void;
  onReset: () => void;
}

export function PanelResizeHandle({
  spec,
  label,
  width,
  onResize,
  onCommit,
  onReset,
}: PanelResizeHandleProps) {
  const handlers = useResizeHandle(spec, width, onResize, onCommit);

  return (
    <div
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemax={spec.max}
      aria-valuemin={spec.min}
      aria-valuenow={width}
      aria-valuetext={`${width} 像素`}
      className={`panel-resize-handle${handlers.dragging ? " is-dragging" : ""}`}
      data-edge={spec.edge}
      onDoubleClick={onReset}
      onKeyDown={handlers.resizeWithKeyboard}
      onPointerCancel={handlers.finishDrag}
      onPointerDown={handlers.startDrag}
      onPointerMove={handlers.resize}
      onPointerUp={handlers.finishDrag}
      role="separator"
      tabIndex={0}
      title={`拖动${label}；双击复位`}
    />
  );
}

function useResizeHandle(
  spec: PanelWidthSpec,
  width: number,
  onResize: (width: number) => void,
  onCommit: () => void,
) {
  const origin = useRef<{ pointerX: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    document.body.classList.add("is-resizing-panel");
    return () => document.body.classList.remove("is-resizing-panel");
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
    const delta = panelWidthDelta(spec, event.clientX - origin.current.pointerX);
    onResize(origin.current.width + delta);
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
    const nextWidth = panelWidthFromKey(spec, event.key, width);
    if (nextWidth === null) return;
    event.preventDefault();
    onResize(nextWidth);
    onCommit();
  };

  return { dragging, finishDrag, resize, resizeWithKeyboard, startDrag };
}
