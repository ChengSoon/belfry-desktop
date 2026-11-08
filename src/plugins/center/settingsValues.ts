import { TranslationError } from "../../i18n";
import type { PluginSettingDefinition } from "./types";
import { numberFromDraft } from "../../components/controls/controlModel";

export function initialValue(setting: PluginSettingDefinition): unknown {
  const value = setting.value ?? setting.default;
  if (value !== undefined) return setting.type === "json" ? JSON.stringify(value, null, 2) : value;
  if (setting.type === "boolean") return false;
  if (setting.type === "number") return 0;
  if (setting.type === "json") return "{}";
  if (setting.type === "select") return setting.enum?.[0]?.value ?? "";
  return "";
}
export function settingsDraft(settings: PluginSettingDefinition[]) {
  return Object.fromEntries(settings.map((setting) => [setting.key, initialValue(setting)]));
}
export function settingsPayload(settings: PluginSettingDefinition[], draft: Record<string, unknown>) {
  const payload = { ...draft };
  for (const setting of settings) {
    if (setting.type === "number") {
      const value = numberFromDraft(String(draft[setting.key] ?? ""));
      if (value === null) throw new TranslationError("plugins.settingsValues.text_40ad1e543f", { title: setting.title });
      payload[setting.key] = value;
    }
    if (setting.type !== "json") continue;
    try { payload[setting.key] = JSON.parse(String(draft[setting.key] ?? "{}")); }
    catch { throw new TranslationError("plugins.settingsValues.text_085885e507", { title: setting.title }); }
  }
  return payload;
}
