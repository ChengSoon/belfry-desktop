import { Minus, Plus } from "lucide-react";
import type { KeyboardEvent, Ref } from "react";
import { clampNumber, numberFromDraft, stepNumber, type NumberBounds } from "./controlModel";
import "./controls.css";

interface Props extends NumberBounds {
  value: string; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean;
  required?: boolean; placeholder?: string; onCommit?: () => void; id?: string;
  inputRef?: Ref<HTMLInputElement>;
  steppers?: boolean;
}

export function NumericField(props: Props) {
  const { value, onChange, ariaLabel, disabled, min, max, step } = props;
  const number = numberFromDraft(value);
  const invalid = value.trim() !== "" && (number === null || clampNumber(number, props) !== number);
  const change = (direction: number) => { if (!disabled) onChange(stepNumber(value, direction, { min, max, step })); };
  const keydown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault(); change(event.key === "ArrowUp" ? 1 : -1);
    }
    if (event.key === "Enter") props.onCommit?.();
  };
  return <div className="ui-control ui-number"><div className="ui-field">
    <input ref={props.inputRef} id={props.id} type="text" role="spinbutton" inputMode="decimal" value={value}
      aria-label={ariaLabel} aria-valuenow={number ?? undefined} aria-valuetext={number === null ? value || "未填写" : value}
      aria-valuemin={min} aria-valuemax={max}
      aria-invalid={invalid || undefined} aria-required={props.required || undefined} disabled={disabled}
      placeholder={props.placeholder} autoComplete="off" onKeyDown={keydown} onBlur={props.onCommit}
      onChange={(event) => onChange(event.target.value)} />
    {props.steppers !== false ? <span className="ui-number__steps">
      <button type="button" className="ui-field__icon" tabIndex={-1} aria-label={`减少${ariaLabel}`}
        disabled={disabled || (number !== null && min !== undefined && number <= min)} onMouseDown={(event) => event.preventDefault()} onClick={() => change(-1)}><Minus size={12} /></button>
      <button type="button" className="ui-field__icon" tabIndex={-1} aria-label={`增加${ariaLabel}`}
        disabled={disabled || (number !== null && max !== undefined && number >= max)} onMouseDown={(event) => event.preventDefault()} onClick={() => change(1)}><Plus size={12} /></button>
    </span> : null}
  </div></div>;
}
