import type { RuntimeTheme } from "./runtimeContracts";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { useTheme } from "../theme/ThemeProvider";
import { Select } from "../components/controls/Select";

export function PluginThemes({ themes }: { themes: RuntimeTheme[] }) {
  const selected = usePluginTheme(), theme = useTheme();
  if (!themes.length) return null;
  return <label className="plugins-theme-picker">插件主题<Select ariaLabel="插件主题"
    value={themes.some((item) => `${item.pluginId}:${item.id}` === selected) ? selected : ""} onChange={(value) => {
    const item = themes.find((entry) => `${entry.pluginId}:${entry.id}` === value);
    if (item) theme.select(item.base ?? "dark"); selectPluginTheme(value);
  }} options={[{ value: "", label: "应用默认主题" }, ...themes.map((item) => ({ value: `${item.pluginId}:${item.id}`,
    label: item.label, description: item.pluginName }))]} /></label>;
}
