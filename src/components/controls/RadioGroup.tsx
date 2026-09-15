import { useRef, type KeyboardEvent } from "react";
import { moveOption } from "./controlModel";
import type { SelectOption } from "./options";
import "./controls.css";

export function RadioGroup<T extends string>({ value, options, onChange, ariaLabel, disabled, className = "" }: {
  value: T; options: readonly SelectOption<T>[]; onChange: (value: T) => void;
  ariaLabel: string; disabled?: boolean; className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.findIndex((option) => option.value === value && !option.disabled);
  const focusIndex = selected >= 0 ? selected : moveOption(options, -1, 1);
  const keydown = (event: KeyboardEvent, index: number) => {
    if (event.nativeEvent.isComposing || disabled) return;
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward) return;
    event.preventDefault();
    const next = moveOption(options, index, forward ? 1 : -1);
    if (next < 0) return;
    onChange(options[next].value); refs.current[next]?.focus();
  };
  return <div role="radiogroup" aria-label={ariaLabel} className={`ui-control ui-radio-group ${className}`}>
    {options.map((option, index) => <button key={option.value} ref={(node) => { refs.current[index] = node; }} type="button"
      role="radio" className="ui-radio" aria-checked={value === option.value} disabled={disabled || option.disabled}
      tabIndex={index === focusIndex ? 0 : -1} onKeyDown={(event) => keydown(event, index)} onClick={() => onChange(option.value)}>
      <span className="ui-radio__mark" aria-hidden="true" /><span className="ui-radio__copy"><strong>{option.label}</strong>
        {option.description ? <small>{option.description}</small> : null}</span>
    </button>)}
  </div>;
}
