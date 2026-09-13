import { CalendarDays } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Calendar } from "./Calendar";
import { ControlPopover } from "./ControlPopover";
import { clampDate, dateParts, todayDate } from "./dateModel";
import { useControlPopover } from "./useControlPopover";

interface Props {
  value: string; onChange: (value: string) => void; ariaLabel: string;
  disabled?: boolean; required?: boolean; min?: string; max?: string; todayMode?: "local" | "utc";
  showError?: boolean;
}

export function DatePicker(props: Props) {
  const { value, onChange, ariaLabel, disabled, required, min, max } = props;
  const popup = useControlPopover<HTMLInputElement>();
  const [touched, setTouched] = useState(false);
  const errorId = useId();
  const invalid = value ? !dateParts(value) || clampDate(value, { min, max }) !== value : !!required;
  const choose = (next: string) => { onChange(next); setTouched(false); popup.close(true); };
  useEffect(() => { if (disabled) popup.close(); }, [disabled, popup.close]);
  return <div className="ui-control ui-date" ref={popup.root} onBlur={(event) => { popup.onBlur(event); setTouched(true); }}>
    <div className="ui-field"><input ref={popup.trigger} type="text" value={value} aria-label={ariaLabel} placeholder="年-月-日"
      maxLength={10} autoComplete="off" inputMode="numeric" aria-required={required || undefined} disabled={disabled}
      aria-invalid={touched && invalid || undefined} aria-describedby={touched && invalid && props.showError !== false ? errorId : undefined}
      onChange={(event) => { onChange(event.target.value); setTouched(false); }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "ArrowDown") { event.preventDefault(); popup.setOpen(true); }
        if (event.key === "Enter" && invalid) { event.preventDefault(); setTouched(true); }
      }} />
      <button type="button" className="ui-field__icon" aria-label={`${ariaLabel}：打开日历`} aria-haspopup="dialog"
        aria-expanded={popup.open} aria-controls={popup.open ? popup.id : undefined} disabled={disabled}
        onMouseDown={(event) => event.preventDefault()} onClick={popup.toggle}><CalendarDays size={14} aria-hidden="true" /></button>
    </div>
    {touched && invalid && props.showError !== false ? <p id={errorId} className="ui-control__error" role="alert">请输入有效日期（YYYY-MM-DD）{min || max ? "，且在允许范围内" : ""}</p> : null}
    <ControlPopover control={popup} width={282} maxHeight={360}>
      <Calendar id={popup.id} value={value} onChange={choose} label={ariaLabel} today={todayDate(props.todayMode)}
        min={min} max={max} clearable={!required} onClose={() => popup.close(true)} />
    </ControlPopover>
  </div>;
}
