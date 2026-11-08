import { formatDateTime, formatNumber, t, useTranslation } from "../../i18n";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { calendarDays, clampDate, dateFromParts, dateParts, moveDate, moveMonth, weekDay } from "./dateModel";
import { focusableControls } from "./layerOwnership";
import { NumericField } from "./NumericField";
import { composingKey } from "../../utils/keyboard";

interface Props {
  id: string; value: string; onChange: (value: string) => void; label: string; today: string;
  min?: string; max?: string; clearable?: boolean; onClose: () => void;
}
export function Calendar(props: Props) {
  const { locale } = useTranslation();
  const week = Array.from({ length: 7 }, (_, day) => formatDateTime(new Date(2024, 0, 7 + day), { weekday: locale === "zh-CN" ? "narrow" : "short" }));
  const [active, setActive] = useState(() => clampDate(dateParts(props.value) ? props.value : props.today, props));
  const [months, setMonths] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const parts = dateParts(active)!;
  const move = (value: string) => setActive(clampDate(value, props));
  useEffect(() => { if (!months) ref.current?.querySelector<HTMLElement>(`[data-date="${active}"]`)?.focus({ preventScroll: true }); }, [active, months]);
  return <div ref={ref} id={props.id} className="ui-calendar" role="dialog" aria-modal="true" aria-label={t("components.Calendar.text_e3da9a5dd3", { label: props.label })} onKeyDown={trapCalendarFocus}>
    <div className="ui-calendar__header">
      <button type="button" aria-label={t("components.Calendar.text_f9e7272234")} disabled={moveMonth(active, -1).slice(0, 7) === active.slice(0, 7)}
        onClick={() => move(moveMonth(active, -1))}><ChevronLeft size={15} aria-hidden="true" /></button>
      <button type="button" className="ui-calendar__title" aria-label={months ? t("components.Calendar.text_157a5d273c") : t("components.Calendar.text_bdb4384ce0")}
        aria-expanded={months} onClick={() => setMonths(!months)}>{formatDateTime(`${active}T12:00:00`, { year: "numeric", month: "long" })}<ChevronDown size={13} aria-hidden="true" /></button>
      <button type="button" aria-label={t("components.Calendar.text_3e0b634699")} disabled={moveMonth(active, 1).slice(0, 7) === active.slice(0, 7)}
        onClick={() => move(moveMonth(active, 1))}><ChevronRight size={15} aria-hidden="true" /></button>
    </div>
    {months ? <CalendarMonths key={parts.year} active={active} onChoose={(date) => { move(date); setMonths(false); }} /> : <>
      <div className="ui-calendar__week" aria-hidden="true">{week.map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="ui-calendar__days" role="group" aria-label={t("components.Calendar.text_70d0c1b336")} onKeyDown={(event) => navigateCalendar(event, active, move)}>
        {calendarDays(active).map((day, index) => day ? <button key={day} type="button" data-date={day}
          className="ui-calendar__day" data-outside={day.slice(0, 7) !== active.slice(0, 7)} aria-label={day}
          aria-pressed={day === props.value} aria-current={day === props.today ? "date" : undefined}
          disabled={clampDate(day, props) !== day} tabIndex={day === active ? 0 : -1} onClick={() => props.onChange(day)}>
          {formatNumber(dateParts(day)!.day)}</button> : <span key={`blank-${index}`} />)}
      </div>
    </>}
    <div className="ui-calendar__footer"><button type="button" disabled={clampDate(props.today, props) !== props.today} onClick={() => props.onChange(props.today)}>{t("components.Calendar.text_d5f5a7a010")}</button>
      {props.clearable ? <button type="button" onClick={() => props.onChange("")}>{t("components.Calendar.text_1ef3de06b3")}</button> : null}
      <button type="button" onClick={props.onClose}>{t("components.Calendar.text_3fd47edce4")}</button></div>
  </div>;
}

function CalendarMonths({ active, onChoose }: { active: string; onChoose: (value: string) => void }) {
  useTranslation();
  const parts = dateParts(active)!;
  const [year, setYear] = useState(String(parts.year));
  const yearRef = useRef<HTMLInputElement>(null);
  const valid = /^\d{1,4}$/.test(year) && Number(year) >= 1;
  useEffect(() => { yearRef.current?.focus({ preventScroll: true }); }, []);
  return <div><label className="ui-calendar__year"><span>{t("components.Calendar.text_bff0b9e4a3")}</span>
    <NumericField inputRef={yearRef} value={year} onChange={setYear} ariaLabel={t("components.Calendar.text_bff0b9e4a3")} min={1} max={9999} step={1} /></label>
    <div className="ui-calendar__months" role="group" aria-label={t("components.Calendar.text_a27822d135")}>
      {Array.from({ length: 12 }, (_, index) => <button key={index} type="button" className="ui-calendar__month"
        disabled={!valid} aria-pressed={parts.month === index + 1 && Number(year) === parts.year}
        onClick={() => onChoose(dateFromParts({ year: Number(year), month: index + 1, day: 1 }))}>{formatDateTime(new Date(2024, index, 1), { month: "short" })}</button>)}
    </div>
  </div>;
}

function navigateCalendar(event: KeyboardEvent, active: string, move: (value: string) => void) {
  if (composingKey(event.nativeEvent) || event.metaKey || event.ctrlKey || event.altKey) return;
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
