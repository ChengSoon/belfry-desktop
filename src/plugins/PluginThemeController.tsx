import { useEffect } from "react";
import { useTheme } from "../theme/ThemeProvider";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { HOST_THEME_ALIASES, sanitizeThemeCss } from "./themeCss";
import { usePluginRuntime } from "./usePluginRuntime";
import { pluginNotice } from "./notices";
import "./center/styles/tokens-01.css";

export function PluginThemeController() {
  const runtime = usePluginRuntime(), key = usePluginTheme(), theme = useTheme();
  const active = runtime.themes.find((item) => `${item.pluginId}:${item.id}` === key);
  useEffect(() => {
    const clear = () => selectPluginTheme("");
    window.addEventListener("theme-base-selected", clear);
    return () => window.removeEventListener("theme-base-selected", clear);
  }, []);
  useEffect(() => {
    if (!active || theme.mode !== (active.base ?? "dark")) return;
    const result = sanitizeThemeCss(active.css);
    if (!result.ok) { pluginNotice(result.error); return; }
    const style = document.createElement("style");
    style.dataset.pluginTheme = key;
    document.documentElement.dataset.pluginTheme = key;
    style.textContent = `${HOST_THEME_ALIASES}\n${result.css}`;
    document.head.append(style);
    return () => { style.remove(); delete document.documentElement.dataset.pluginTheme; };
  }, [active?.css, active?.base, key, theme.mode]);
  return null;
}
