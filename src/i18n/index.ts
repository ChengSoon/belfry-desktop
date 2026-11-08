import { useCallback, useState, useSyncExternalStore } from "react";
import { flattenCatalog, translate, type Catalogs, type Locale, type Values } from "./core";
import { getLocale, localeStore, setLocalePreference } from "./store";
export { getLocale, setLocalePreference } from "./store";
export type { Locale, LocalePreference, Values } from "./core";

const catalogs: Catalogs = { "zh-CN": {}, en: {} };
for (const [path, value] of Object.entries(import.meta.glob<Record<string, unknown>>("./locales/*/*.json", { eager: true, import: "default" }))) {
  const [, locale, module] = path.match(/\/([^/]+)\/([^/]+)\.json$/)!;
  Object.assign(catalogs[locale as Locale], flattenCatalog(value, module));
}
const warned = new Set<string>();
function warnMissing(key: string, locale: Locale) {
  const id = `${locale}:${key}`;
  if (import.meta.env.DEV && !warned.has(id)) {
    warned.add(id); console.warn(`[i18n] Missing translation: ${id}`);
  }
}
export function t(key: string, values?: Values): string { return translate(catalogs, getLocale(), key, values, warnMissing); }
export function hasTranslation(key: string, locale = getLocale()) { return catalogs[locale][key] !== undefined; }
export function useTranslation() {
  const snapshot = useSyncExternalStore(localeStore.subscribe, localeStore.getSnapshot, localeStore.getSnapshot);
  return { ...snapshot, t, setLocale: setLocalePreference, i18n: { language: snapshot.locale } };
}
export function useLocale() { return useTranslation().locale; }

/** Keep pure message formatting until render so changing language preserves the feedback. */
export function useFeedback<T extends string | null | undefined>(initial: T): [string | Extract<T, null | undefined>, (value: unknown) => void];
export function useFeedback<T extends string | null | undefined = string>(): [string | Extract<T, null> | undefined, (value: unknown) => void];
export function useFeedback(initial?: string | null) {
  useLocale();
  const [source, setSource] = useState<{ value: unknown }>(() => ({ value: initial }));
  const update = useCallback((value: unknown) => setSource(current => Object.is(current.value, value) ? current : { value }), []);
  const value = typeof source.value === "function" ? source.value() : source.value;
  return [value == null ? value : errorMessage(value), update] as const;
}

/** A validation failure retains its key and values while remaining a normal Error. */
export class TranslationError extends Error {
  constructor(key: string, values?: Values) {
    super(t(key, values));
    Object.defineProperty(this, "message", { configurable: true, get: () => t(key, values) });
  }
}

/** Read-only module-level labels stay current without remounting consumers. */
export function localized<T extends object>(factory: () => T): T {
  let locale = getLocale(), value = factory();
  const current = () => { if (locale !== getLocale()) { locale = getLocale(); value = factory(); } return value; };
  return new Proxy(value, {
    get: (_, key) => Reflect.get(current(), key),
    has: (_, key) => Reflect.has(current(), key),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_, key) => Reflect.getOwnPropertyDescriptor(current(), key),
  });
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}
export function formatList(values: readonly string[]): string {
  return new Intl.ListFormat(getLocale(), { style: "long", type: "unit" }).format(values);
}
export function formatCurrency(value: number, currency = "USD", options?: Intl.NumberFormatOptions): string {
  return formatNumber(value, { style: "currency", currency, ...options });
}
export function formatDateTime(value: Date | string | number, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(getLocale(), options).format(date) : "—";
}
export function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const value = error as { code?: unknown; message?: unknown; params?: unknown };
    if (typeof value.code === "string" && hasTranslation(`errors.${value.code}`)) {
      return t(`errors.${value.code}`, value.params && typeof value.params === "object" ? value.params as Values : {});
    }
    if (typeof value.message === "string") return value.message;
  }
  return String(error);
}
