import { getLocale, t } from "../i18n";
import type { QuickOpenItem } from "../quickopen/model";
import type { LocalizedText, RuntimeCatalog } from "./runtimeContracts";

export function pluginCommandItems(catalog: RuntimeCatalog): QuickOpenItem[] {
  return catalog.commands.map((item) => ({
    id: `plugin:${item.pluginId}:${item.id}`, kind: "action", title: item.title,
    subtitle: t("plugins.runtimeCatalog.text_07829985cc", { pluginName: item.pluginName }), keywords: item.keywords, icon: "bot",
    value: `${item.pluginId}:${item.id}`,
  }));
}
export function localizedText(value: LocalizedText | undefined, fallback: string): string {
  return typeof value === "string" ? value : value?.[getLocale()] ?? value?.["zh-CN"] ?? value?.en ?? fallback;
}
