// Adapted from PI-Desktop PluginSettingsSheet.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useState } from "react";
import { Dropdown, Input, Textarea, cx } from "./ui";
import { isMac, shortcutFromEvent, shortcutLabel, shortcutConflict } from "./shortcuts";
import type { PluginSettingDefinition } from "./types";
import { t } from "./i18n";

interface Props { setting: PluginSettingDefinition; value: unknown; onChange: (value: unknown) => void; disabled: boolean }
export function SettingControl({ setting, value, onChange, disabled }: Props) {
  const props = { disabled, "aria-label": setting.title };
  if (setting.type === "boolean") return <button {...props} type="button" className={cx("settings-toggle", value === true && "on")} role="switch" aria-checked={value === true}
    onClick={() => onChange(value !== true)}><span className="settings-toggle-thumb" /></button>;
  if (setting.type === "select") return <SelectControl setting={setting} value={value} onChange={onChange} disabled={disabled} />;
  if (setting.type === "json") return <Textarea {...props} className="plugins-setting-json" value={String(value ?? "{}")} onChange={(event) => onChange(event.target.value)} />;
  if (setting.type === "shortcut") return <ShortcutControl setting={setting} value={value} onChange={onChange} disabled={disabled} />;
  return <Input {...props} type={setting.type === "number" ? "number" : "text"} value={String(value ?? "")}
    onChange={(event) => onChange(setting.type === "number" ? Number(event.target.value) : event.target.value)} />;
}
function SelectControl({ setting, value, onChange, disabled }: Props) {
  const options = setting.enum ?? [];
  // 用索引关联原始值，保留字符串、数字和布尔值的区别。
  const entries = options.map((option, index) => ({ value: index, label: option.label }));
  const selected = options.findIndex((option) => Object.is(option.value, value));
  return <Dropdown options={entries} value={selected} disabled={disabled} ariaLabel={setting.title}
    onChange={(index) => { const option = options[index]; if (option) onChange(option.value); }} />;
}
function ShortcutControl({ setting, value, onChange, disabled }: Props) {
  const [recording, setRecording] = useState(false), [invalid, setInvalid] = useState(false);
  return <button type="button" disabled={disabled} data-shortcut-recorder={recording} className={cx("plugins-shortcut-recorder", recording && "recording", invalid && "error")}
    aria-label={t("plugins.settingsShortcutChange", { name: setting.title })} title={invalid ? t("plugins.settingsShortcutInvalid") : undefined}
    onClick={() => setRecording(!recording)} onKeyDown={(event) => {
      if (!recording) return;
      event.preventDefault(); event.stopPropagation();
      if (event.key === "Escape") { setRecording(false); return; }
      if (event.key === "Backspace" || event.key === "Delete") { onChange(""); setRecording(false); return; }
      const binding = shortcutFromEvent(event, isMac());
      if (!binding) return;
      const conflict = shortcutConflict([binding], isMac()); setInvalid(conflict);
      if (!conflict) { onChange(binding); setRecording(false); }
    }}>{recording ? t("plugins.settingsShortcutRecording") : shortcutLabel(String(value ?? ""), isMac())}</button>;
}
