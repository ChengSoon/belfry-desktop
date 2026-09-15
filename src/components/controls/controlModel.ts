export interface OptionItem { label?: string; description?: string; disabled?: boolean }
export interface NumberBounds { min?: number; max?: number; step?: number }

export function moveOption(options: readonly OptionItem[], current: number, direction: number) {
  const start = current >= 0 ? current : direction > 0 ? -1 : 0;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const next = ((start + direction * offset) % options.length + options.length) % options.length;
    if (!options[next].disabled) return next;
  }
  return -1;
}

export function matchesOption(option: OptionItem, query: string) {
  return `${option.label ?? ""} ${option.description ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
}

export function findOption(options: readonly OptionItem[], query: string, current: number) {
  for (let offset = 1; offset <= options.length; offset += 1) {
    const next = (current + offset + options.length) % options.length;
    if (!options[next].disabled && matchesOption(options[next], query)) return next;
  }
  return -1;
}

export function numberFromDraft(value: string) {
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function clampNumber(value: number, bounds: NumberBounds) {
  return Math.max(bounds.min ?? -Infinity, Math.min(bounds.max ?? Infinity, value));
}

export function normalizeNumber(value: number, bounds: NumberBounds) {
  if (bounds.min !== undefined && value <= bounds.min) return bounds.min;
  if (bounds.max !== undefined && value >= bounds.max) return bounds.max;
  const step = bounds.step && bounds.step > 0 ? bounds.step : 1;
  const base = bounds.min ?? 0;
  const rounded = base + Math.round((value - base) / step) * step;
  return clampNumber(Number(rounded.toPrecision(12)), bounds);
}

export function stepNumber(value: string, direction: number, bounds: NumberBounds) {
  const start = numberFromDraft(value) ?? bounds.min ?? 0;
  const step = bounds.step && bounds.step > 0 ? bounds.step : 1;
  return String(clampNumber(Number((start + direction * step).toPrecision(12)), bounds));
}
