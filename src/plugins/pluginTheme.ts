import { useSyncExternalStore } from "react";

const KEY = "belfry.plugin-theme.v1";
const EVENT = "plugin-theme-selected";
const MAP: Record<string, string> = {
  "--ds-bg-primary": "--canvas", "--ds-bg-secondary": "--surface", "--ds-bg-tertiary": "--surface-raised",
  "--ds-bg-under": "--sidebar", "--ds-accent": "--accent", "--ds-accent-hover": "--accent-hover", "--ds-accent-soft": "--accent-soft",
  "--ds-text-primary": "--text", "--ds-text-secondary": "--text-muted", "--ds-border": "--border",
};
const COLORS = new Set(["--canvas", "--surface", "--surface-raised", "--surface-hover", "--sidebar", "--sidebar-active", "--sidebar-hover", "--border", "--border-strong",
  "--text", "--text-muted", "--text-faint", "--accent", "--accent-hover", "--accent-soft", "--accent-contrast", "--success", "--warning", "--danger", "--danger-hover", "--scrollbar"]);
export function themeTokens(css: string) {
  if (css.length > 64 * 1024) throw new Error("插件主题过大");
  const result: Record<string, string> = {};
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const match of clean.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;{}]+)\s*;?/g)) {
    const key = MAP[match[1]] ?? match[1], value = match[2].trim();
    if (!COLORS.has(key) || /url|expression|@|\\|["']/i.test(value)) continue;
    if (!/^(?:#[0-9a-f]{3,8}|[a-z]+|(?:rgba?|hsla?|oklch|oklab)\([0-9.% ,/+-]+\))$/i.test(value)) continue;
    result[key] = value;
  }
  return result;
}
function selected() { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } }
function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify); window.addEventListener("storage", notify);
  return () => { window.removeEventListener(EVENT, notify); window.removeEventListener("storage", notify); };
}
export function selectPluginTheme(key: string) {
  try { localStorage.setItem(KEY, key); } catch { /* 存储不可用时仍保持现有外观。 */ }
  window.dispatchEvent(new Event(EVENT));
}
export function usePluginTheme() { return useSyncExternalStore(subscribe, selected, () => ""); }
