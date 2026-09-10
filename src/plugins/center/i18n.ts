// PI-Desktop 中文文案，LGPL-3.0；来源见 third_party/pi-desktop/NOTICE.md。
import labels from "./labels.json";
import permissions from "./permissionLabels.json";
import other from "./otherLabels.json";

const catalog = { plugins: { ...labels, ...permissions }, ...other };
export function t(key: string, values: Record<string, unknown> = {}): string {
  let value: unknown = catalog;
  for (const part of key.split(".")) {
    if (!value || typeof value !== "object") { value = undefined; break; }
    const entries = value as Record<string, unknown>;
    const remaining = key.slice(key.indexOf(part));
    if (typeof entries[remaining] === "string") { value = entries[remaining]; break; }
    value = entries[part];
  }
  const text = typeof value === "string" ? value : String(values.defaultValue ?? key);
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ""));
}
export function useTranslation() { return { t, i18n: { language: "zh-CN" } }; }
