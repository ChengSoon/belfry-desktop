export type Locale = "zh-CN" | "en";
export type LocalePreference = "system" | Locale;
export type Values = Record<string, unknown>;
export type PluralText = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Translation = string | PluralText;
export type Catalogs = Record<Locale, Record<string, Translation>>;

export function resolveLocale(preference: LocalePreference, languages: readonly string[]): Locale {
  return preference === "system" ? (/^zh(?:-|$)/i.test(languages[0] ?? "zh-CN") ? "zh-CN" : "en") : preference;
}

export function translate(catalogs: Catalogs, locale: Locale, key: string, values: Values = {}, missing?: (key: string, locale: Locale) => void): string {
  let entry = catalogs[locale][key], entryLocale = locale;
  if (entry === undefined) {
    missing?.(key, locale);
    entry = catalogs["zh-CN"][key]; entryLocale = "zh-CN";
  }
  if (entry === undefined) return String(values.defaultValue ?? key);
  const count = Number(values.count);
  const text = typeof entry === "string" ? entry : entry[Number.isFinite(count) ? new Intl.PluralRules(entryLocale).select(count) : "other"] ?? entry.other;
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => typeof values[name] === "number"
    ? new Intl.NumberFormat(locale).format(values[name] as number) : String(values[name] ?? ""));
}

export function flattenCatalog(value: Record<string, unknown>, prefix = ""): Record<string, Translation> {
  const result: Record<string, Translation> = {};
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === "string") result[path] = entry;
    else if (entry && typeof entry === "object") {
      const entries = entry as Record<string, unknown>;
      if (typeof entries.other === "string" && Object.keys(entries).every(key => /^(zero|one|two|few|many|other)$/.test(key))) result[path] = entries as PluralText;
      else Object.assign(result, flattenCatalog(entries, path));
    }
  }
  return result;
}
