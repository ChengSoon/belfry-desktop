import { resolveLocale, type Locale, type LocalePreference } from "./core";

export const LOCALE_KEY = "belfry.locale.v1";
export function parsePreference(value: string | null): LocalePreference {
  return value === "zh-CN" || value === "en" ? value : "system";
}
interface LocaleEnvironment {
  read: () => string | null;
  write: (preference: LocalePreference) => void;
  languages: () => readonly string[];
  apply?: (locale: Locale) => void;
}
export function createLocaleStore(environment: LocaleEnvironment) {
  let preference: LocalePreference = "system";
  try { preference = parsePreference(environment.read()); } catch { /* Storage can be unavailable. */ }
  let snapshot = { preference, locale: resolveLocale(preference, environment.languages()) };
  const listeners = new Set<() => void>();
  const update = (next: LocalePreference) => {
    const locale = resolveLocale(next, environment.languages());
    if (next === snapshot.preference && locale === snapshot.locale) return;
    snapshot = { preference: next, locale };
    environment.apply?.(locale);
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setPreference: (preference: LocalePreference) => {
      try { environment.write(preference); } catch { /* In-memory switching still works. */ }
      update(preference);
    },
    systemChanged: () => update(snapshot.preference),
    storageChanged: (value: string | null) => update(parsePreference(value)),
  };
}

export const localeStore = createLocaleStore({
  read: () => typeof window === "undefined" ? null : localStorage.getItem(LOCALE_KEY),
  write: preference => localStorage.setItem(LOCALE_KEY, preference),
  languages: () => typeof window === "undefined" ? ["zh-CN"] : navigator.languages?.length ? navigator.languages : [navigator.language],
  apply: locale => { if (typeof document !== "undefined") document.documentElement.lang = locale; },
});
export const getLocale = () => localeStore.getSnapshot().locale;
export const setLocalePreference = localeStore.setPreference;

/** Serialize native writes so a slow response cannot restore an earlier language. */
export function synchronizeLocale(write: (locale: Locale) => Promise<unknown>) {
  let chain = Promise.resolve();
  const sync = () => {
    const locale = getLocale();
    chain = chain.then(() => write(locale)).then(() => undefined, () => undefined);
  };
  sync();
  return localeStore.subscribe(sync);
}

export function initializeLocale() {
  document.documentElement.lang = getLocale();
  window.addEventListener("languagechange", localeStore.systemChanged);
  const onStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_KEY || event.key === null) localeStore.storageChanged(event.key === null ? null : event.newValue);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("languagechange", localeStore.systemChanged);
    window.removeEventListener("storage", onStorage);
  };
}
