import type { ThemeMode } from "./contracts";

/** 与 index.html 首帧脚本内联的键名保持一致，改这里要同步改那边。 */
export const THEME_MODE_KEY = "otty.theme.v1";

export function loadThemeMode(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    return parseThemeMode(storage.getItem(THEME_MODE_KEY));
  } catch {
    return null;
  }
}

export function saveThemeMode(mode: ThemeMode, storage: Pick<Storage, "setItem"> = localStorage) {
  storage.setItem(THEME_MODE_KEY, mode);
}

export function parseThemeMode(value: string | null): ThemeMode | null {
  return value === "dark" || value === "light" ? value : null;
}
