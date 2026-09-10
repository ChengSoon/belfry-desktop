import type { PluginSettingDefinition } from "./types";

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
    if (setting.type !== "json") continue;
    try { payload[setting.key] = JSON.parse(String(draft[setting.key] ?? "{}")); }
    catch { throw new Error(`${setting.title} 的 JSON 格式不正确`); }
  }
  return payload;
}
