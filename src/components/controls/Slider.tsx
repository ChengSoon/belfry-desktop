import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { normalizeNumber } from "./controlModel";
import "./controls.css";

interface Props { value: number; min: number; max: number; step: number; onChange: (value: number) => void; ariaLabel: string; valueText?: string; disabled?: boolean }
const PAGE_STEPS = 10;

export function Slider(props: Props) {
  const { value, min, max, step, onChange, ariaLabel, valueText, disabled } = props;
  const dragging = useRef<number | null>(null);
  const rail = useRef<HTMLSpanElement>(null);
  const change = (next: number) => { if (!disabled) onChange(normalizeNumber(next, { min, max, step })); };
  const pointer = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || !rail.current || dragging.current !== event.pointerId) return;
    const rect = rail.current.getBoundingClientRect();
    if (rect.width) change(min + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (max - min));
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing || disabled || event.ctrlKey || event.metaKey || event.altKey) return;
    const changes: Record<string, number> = { ArrowUp: value + step, ArrowRight: value + step, ArrowDown: value - step,
      ArrowLeft: value - step, Home: min, End: max, PageUp: value + step * PAGE_STEPS, PageDown: value - step * PAGE_STEPS };
    if (changes[event.key] !== undefined) { event.preventDefault(); change(changes[event.key]); }
  };
  const position = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  return <div className="ui-control ui-slider" role="slider" aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={value} aria-valuetext={valueText} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
    style={{ "--slider-value": `${position}%` } as CSSProperties} onKeyDown={keydown}
    onPointerDown={(event) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus(); dragging.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId); pointer(event);
    }} onPointerMove={pointer} onPointerUp={(event) => { pointer(event); dragging.current = null; }}
    onPointerCancel={() => { dragging.current = null; }} onLostPointerCapture={() => { dragging.current = null; }}>
    <span ref={rail} className="ui-slider__rail"><span className="ui-slider__fill" /><span className="ui-slider__thumb" /></span>
  </div>;
}
