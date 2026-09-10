import type { PiSetting } from "./runtimeContracts";

export function settingDraft(setting: PiSetting, value: unknown): string {
  if (setting.type === "json") return JSON.stringify(value ?? null, null, 2);
  if (setting.type === "select") return String(setting.enum?.findIndex((option) => option.value === value) ?? -1);
  return value === undefined || value === null ? "" : String(value);
}
export function parseSettingDraft(setting: PiSetting, text: string): unknown {
  const label = setting.title ?? setting.key;
  if (setting.type === "number") {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error(`${label} 需要有效数字`);
    return Number(text);
  }
  if (setting.type === "boolean") return text === "true";
  if (setting.type === "json") {
    try { return JSON.parse(text); } catch { throw new Error(`${label} 的 JSON 格式无效`); }
  }
  if (setting.type === "select") {
    const option = setting.enum?.[Number(text)];
    if (!option) throw new Error(`请选择 ${label}`);
    return option.value;
  }
  return text;
}
