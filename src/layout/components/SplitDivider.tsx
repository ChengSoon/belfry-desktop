import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import type { DividerFrame } from "../contracts";
import { clampRatio, MIN_RATIO } from "../tree";

const KEY_STEP = 0.02;

interface SplitDividerProps {
  divider: DividerFrame;
  stageRef: RefObject<HTMLElement | null>;
  onResize: (path: string, ratio: number) => void;
}

/**
 * 分屏的分隔条。拖动改的是所属 split 的 ratio，
 * 像素位移要先除以该 split 在这个方向上占的实际长度——嵌套分屏里它只占舞台的一部分。
 */
export function SplitDivider({ divider, stageRef, onResize }: SplitDividerProps) {
  const origin = useRef<{ pointer: number; ratio: number; span: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const horizontal = divider.direction === "row";
  const ratio = divider.ratio;

  const style = {
    left: `${divider.rect.left}%`,
    top: `${divider.rect.top}%`,
    ...(horizontal ? { height: `${divider.rect.height}%` } : { width: `${divider.rect.width}%` }),
  } as CSSProperties;

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) return;
    // span 是百分比，换成像素才能把位移折成比例。
    const spanPx = ((horizontal ? stage.width : stage.height) * divider.span) / 100;
    if (spanPx <= 0) return;
    origin.current = { pointer: horizontal ? event.clientX : event.clientY, ratio, span: spanPx };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };

  const resize = (event: PointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start) return;
    event.preventDefault();
    const delta = (horizontal ? event.clientX : event.clientY) - start.pointer;
    onResize(divider.path, clampRatio(start.ratio + delta / start.span));
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!origin.current) return;
    origin.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const shrink = horizontal ? "ArrowLeft" : "ArrowUp";
    const grow = horizontal ? "ArrowRight" : "ArrowDown";
    const next = event.key === shrink
      ? ratio - KEY_STEP
      : event.key === grow
        ? ratio + KEY_STEP
        : event.key === "Home"
          ? MIN_RATIO
          : event.key === "End"
            ? 1 - MIN_RATIO
            : null;
    if (next === null) return;
    event.preventDefault();
    onResize(divider.path, clampRatio(next));
  };

  return (
    <div
      aria-label={horizontal ? "调整左右窗格比例" : "调整上下窗格比例"}
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`${Math.round(ratio * 100)}%`}
      className={`split-divider split-divider--${divider.direction}${dragging ? " is-dragging" : ""}`}
      onDoubleClick={() => onResize(divider.path, 0.5)}
      onKeyDown={resizeWithKeyboard}
      onPointerCancel={finishDrag}
      onPointerDown={startDrag}
      onPointerMove={resize}
      onPointerUp={finishDrag}
      role="separator"
      style={style}
      tabIndex={0}
      title="拖动调整窗格比例；双击对半分"
    />
  );
}
