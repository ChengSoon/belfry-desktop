import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { calendarDays, clampDate, dateFromParts, dateParts, moveDate, moveMonth, weekDay } from "./dateModel";
import { focusableControls } from "./layerOwnership";
import { NumericField } from "./NumericField";

interface Props {
  id: string; value: string; onChange: (value: string) => void; label: string; today: string;
  min?: string; max?: string; clearable?: boolean; onClose: () => void;
}
const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

export function Calendar(props: Props) {
  const [active, setActive] = useState(() => clampDate(dateParts(props.value) ? props.value : props.today, props));
  const [months, setMonths] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const parts = dateParts(active)!;
  const move = (value: string) => setActive(clampDate(value, props));
  useEffect(() => { if (!months) ref.current?.querySelector<HTMLElement>(`[data-date="${active}"]`)?.focus({ preventScroll: true }); }, [active, months]);
  return <div ref={ref} id={props.id} className="ui-calendar" role="dialog" aria-modal="true" aria-label={`${props.label}：日历`} onKeyDown={trapCalendarFocus}>
    <div className="ui-calendar__header">
      <button type="button" aria-label="上个月" disabled={moveMonth(active, -1).slice(0, 7) === active.slice(0, 7)}
        onClick={() => move(moveMonth(active, -1))}><ChevronLeft size={15} aria-hidden="true" /></button>
      <button type="button" className="ui-calendar__title" aria-label={months ? "返回日期选择" : "选择年月"}
        aria-expanded={months} onClick={() => setMonths(!months)}>{parts.year} 年 {parts.month} 月<ChevronDown size={13} aria-hidden="true" /></button>
      <button type="button" aria-label="下个月" disabled={moveMonth(active, 1).slice(0, 7) === active.slice(0, 7)}
        onClick={() => move(moveMonth(active, 1))}><ChevronRight size={15} aria-hidden="true" /></button>
    </div>
    {months ? <CalendarMonths key={parts.year} active={active} onChoose={(date) => { move(date); setMonths(false); }} /> : <>
      <div className="ui-calendar__week" aria-hidden="true">{WEEK.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="ui-calendar__days" role="group" aria-label="日期" onKeyDown={(event) => navigateCalendar(event, active, move)}>
        {calendarDays(active).map((day, index) => day ? <button key={day} type="button" data-date={day}
          className="ui-calendar__day" data-outside={day.slice(0, 7) !== active.slice(0, 7)} aria-label={day}
          aria-pressed={day === props.value} aria-current={day === props.today ? "date" : undefined}
          disabled={clampDate(day, props) !== day} tabIndex={day === active ? 0 : -1} onClick={() => props.onChange(day)}>
          {dateParts(day)!.day}</button> : <span key={`blank-${index}`} />)}
      </div>
    </>}
    <div className="ui-calendar__footer"><button type="button" disabled={clampDate(props.today, props) !== props.today} onClick={() => props.onChange(props.today)}>今天</button>
      {props.clearable ? <button type="button" onClick={() => props.onChange("")}>清空</button> : null}
      <button type="button" onClick={props.onClose}>关闭</button></div>
  </div>;
}

function CalendarMonths({ active, onChoose }: { active: string; onChoose: (value: string) => void }) {
  const parts = dateParts(active)!;
  const [year, setYear] = useState(String(parts.year));
  const yearRef = useRef<HTMLInputElement>(null);
  const valid = /^\d{1,4}$/.test(year) && Number(year) >= 1;
  useEffect(() => { yearRef.current?.focus({ preventScroll: true }); }, []);
  return <div><label className="ui-calendar__year"><span>年份</span>
    <NumericField inputRef={yearRef} value={year} onChange={setYear} ariaLabel="年份" min={1} max={9999} step={1} /></label>
    <div className="ui-calendar__months" role="group" aria-label="月份">
      {Array.from({ length: 12 }, (_, index) => <button key={index} type="button" className="ui-calendar__month"
        disabled={!valid} aria-pressed={parts.month === index + 1 && Number(year) === parts.year}
        onClick={() => onChoose(dateFromParts({ year: Number(year), month: index + 1, day: 1 }))}>{index + 1} 月</button>)}
    </div>
  </div>;
}

function navigateCalendar(event: KeyboardEvent, active: string, move: (value: string) => void) {
  if (event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
  const shifts: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    Home: -weekDay(active), End: 6 - weekDay(active) };
  if (shifts[event.key] !== undefined) { event.preventDefault(); move(moveDate(active, shifts[event.key])); }
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault(); move(moveMonth(active, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
  }
}

function trapCalendarFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const controls = focusableControls(event.currentTarget);
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
