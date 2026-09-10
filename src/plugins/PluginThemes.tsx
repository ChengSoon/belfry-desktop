import type { RuntimeTheme } from "./runtimeContracts";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { useTheme } from "../theme/ThemeProvider";

export function PluginThemes({ themes }: { themes: RuntimeTheme[] }) {
  const selected = usePluginTheme(), theme = useTheme();
  if (!themes.length) return null;
  return <label className="plugins-theme-picker">插件主题<select value={themes.some((item) => `${item.pluginId}:${item.id}` === selected) ? selected : ""} onChange={(event) => {
    const value = event.target.value, item = themes.find((entry) => `${entry.pluginId}:${entry.id}` === value);
    if (item) theme.select(item.base ?? "dark"); selectPluginTheme(value);
  }}><option value="">应用默认主题</option>{themes.map((item) => <option key={`${item.pluginId}:${item.id}`} value={`${item.pluginId}:${item.id}`}>{item.label} · {item.pluginName}</option>)}</select></label>;
}
