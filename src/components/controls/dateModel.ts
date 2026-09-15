export interface DateParts { year: number; month: number; day: number }
export const FIRST_DATE = "0001-01-01";
export const LAST_DATE = "9999-12-31";
const WEEK_DAYS = 7;
const CALENDAR_CELLS = 42;

function utcDate(parts: DateParts) {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}

function fromDate(date: Date) {
  return dateFromParts({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}

export function dateFromParts({ year, month, day }: DateParts) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function dateParts(value: string): DateParts | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return fromDate(utcDate({ year, month, day })) === value ? { year, month, day } : null;
}

export function clampDate(value: string, bounds: { min?: string; max?: string } = {}) {
  return value < (bounds.min || FIRST_DATE) ? bounds.min || FIRST_DATE
    : value > (bounds.max || LAST_DATE) ? bounds.max || LAST_DATE : value;
}

export function moveDate(value: string, days: number) {
  const parts = dateParts(value);
  if (!parts) return value;
  const next = utcDate({ ...parts, day: parts.day + days });
  if (next.getUTCFullYear() < 1) return FIRST_DATE;
  if (next.getUTCFullYear() > 9999) return LAST_DATE;
  return fromDate(next);
}

export function moveMonth(value: string, months: number) {
  const parts = dateParts(value);
  if (!parts) return value;
  const date = utcDate({ year: parts.year, month: parts.month + months, day: 1 });
  if (date.getUTCFullYear() < 1) return FIRST_DATE;
  if (date.getUTCFullYear() > 9999) return LAST_DATE;
  const lastDay = utcDate({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 2, day: 0 }).getUTCDate();
  date.setUTCDate(Math.min(parts.day, lastDay));
  return fromDate(date);
}

export function weekDay(value: string) {
  return (utcDate(dateParts(value)!).getUTCDay() + WEEK_DAYS - 1) % WEEK_DAYS;
}

export function calendarDays(value: string): Array<string | null> {
  const parts = dateParts(value)!;
  const first = dateFromParts({ ...parts, day: 1 });
  const offset = weekDay(first);
  return Array.from({ length: CALENDAR_CELLS }, (_, index) => {
    const date = utcDate({ ...parts, day: index - offset + 1 });
    return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? null : fromDate(date);
  });
}

export function todayDate(mode: "local" | "utc" = "local", date = new Date()) {
  return mode === "utc" ? fromDate(date) : dateFromParts({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}
