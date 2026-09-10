import type { ThemeMode } from "../theme/contracts";
import { sanitizeThemeCss } from "./themeCss";

interface Theme { id: string; base?: ThemeMode; css: string }
export function pluginAppearance(preference: { mode: ThemeMode; pinned: boolean }, key: string, active?: Theme) {
  const result = active && (active.base ?? "dark") === preference.mode ? sanitizeThemeCss(active.css) : undefined;
  const pluginTheme = result?.ok ? { id: key, base: active?.base ?? "dark", css: result.css } : null;
  return { theme: pluginTheme ? `plugin:${key}` : preference.pinned ? preference.mode : "system",
    base: preference.mode, locale: "zh-CN", pluginTheme };
}
