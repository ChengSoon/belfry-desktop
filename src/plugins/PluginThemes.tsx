import { t, useTranslation } from "../i18n";
import type { RuntimeTheme } from "./runtimeContracts";
import { selectPluginTheme, usePluginTheme } from "./pluginTheme";
import { useTheme } from "../theme/ThemeProvider";
import { Select } from "../components/controls/Select";

export function PluginThemes({ themes }: { themes: RuntimeTheme[] }) {
  useTranslation();
  const selected = usePluginTheme(), theme = useTheme();
  if (!themes.length) return null;
  return <label className="plugins-theme-picker">{t("plugins.PluginThemes.text_4f91c7d37c")}<Select ariaLabel={t("plugins.PluginThemes.text_4f91c7d37c")}
    value={themes.some((item) => `${item.pluginId}:${item.id}` === selected) ? selected : ""} onChange={(value) => {
    const item = themes.find((entry) => `${entry.pluginId}:${entry.id}` === value);
    if (item) theme.select(item.base ?? "dark"); selectPluginTheme(value);
  }} options={[{ value: "", label: t("plugins.PluginThemes.text_167f9c4baf") }, ...themes.map((item) => ({ value: `${item.pluginId}:${item.id}`,
    label: item.label, description: item.pluginName }))]} /></label>;
}
