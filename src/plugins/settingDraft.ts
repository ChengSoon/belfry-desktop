import { TranslationError } from "../i18n";
import type { PiSetting } from "./runtimeContracts";
import { numberFromDraft } from "../components/controls/controlModel";

export function settingDraft(setting: PiSetting, value: unknown): string {
  if (setting.type === "json") return JSON.stringify(value ?? null, null, 2);
  if (setting.type === "select") return String(setting.enum?.findIndex((option) => option.value === value) ?? -1);
  return value === undefined || value === null ? "" : String(value);
}
export function parseSettingDraft(setting: PiSetting, text: string): unknown {
  const label = setting.title ?? setting.key;
  if (setting.type === "number") {
    const value = numberFromDraft(text);
    if (value === null) throw new TranslationError("plugins.settingDraft.text_d22447d004", { label: label });
    return value;
  }
  if (setting.type === "boolean") return text === "true";
  if (setting.type === "json") {
    try { return JSON.parse(text); } catch { throw new TranslationError("plugins.settingDraft.text_7665349bc0", { label: label }); }
  }
  if (setting.type === "select") {
    const option = setting.enum?.[Number(text)];
    if (!option) throw new TranslationError("plugins.settingDraft.text_27a7658d4c", { label: label });
    return option.value;
  }
  return text;
}
