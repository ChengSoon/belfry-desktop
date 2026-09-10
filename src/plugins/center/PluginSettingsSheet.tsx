// Adapted from PI-Desktop PluginSettingsSheet.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useState } from "react";
import { usePluginsPage } from "./context";
import { Button } from "./ui";
import { IconKeyboard, IconSettings, IconX } from "./icons";
import { t } from "./i18n";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginError } from "../hostClient";
import { initialValue, settingsDraft, settingsPayload } from "./settingsValues";
import { isMac, shortcutConflict } from "./shortcuts";
import { SettingControl } from "./SettingControl";
import { useModal } from "./useModal";

export function PluginSettingsSheet() {
  const { settingsPlugin: plugin, setSettingsPlugin, data } = usePluginsPage();
  const fields = plugin!.settings ?? [];
  const [draft, setDraft] = useState(() => settingsDraft(fields));
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const ref = useModal(() => setSettingsPlugin(null), saving);
  const change = (key: string, value: unknown) => { setDraft((current) => ({ ...current, [key]: value })); setError(""); };
  const save = async () => {
    if (saving) return;
    setSaving(true); setError("");
    try {
      const bindings = fields.filter((field) => field.type === "shortcut").map((field) => String(draft[field.key] ?? ""));
      if (shortcutConflict(bindings, isMac())) throw new Error(t("plugins.settingsShortcutConflict"));
      await pluginHost.setSettings(plugin!.id, settingsPayload(fields, draft));
      await data.refresh(); setSettingsPlugin(null);
    } catch (reason) { setError(pluginError(reason)); }
    finally { setSaving(false); }
  };
  return <div className="plugins-modal-backdrop" role="presentation" ref={ref}><div className="plugins-modal plugins-settings-modal" role="dialog" aria-modal="true" aria-label={t("plugins.settingsTitle", { name: plugin!.name })}>
    <header className="plugins-modal-head"><span className="plugins-modal-icon" aria-hidden><IconSettings size={17} /></span>
      <div className="plugins-settings-heading"><h2 className="plugins-modal-title">{t("plugins.settingsTitle", { name: plugin!.name })}</h2><p className="plugins-modal-subtitle">{t("plugins.settingsHint")}</p></div>
      <button type="button" className="plugins-icon-btn" aria-label={t("plugins.closeSettings")} disabled={saving} onClick={() => setSettingsPlugin(null)}><IconX size={15} /></button></header>
    <div className="plugins-settings-body">{fields.map((field) => <div key={field.key} className="plugins-setting-row">
      <div className="plugins-setting-copy"><div className="plugins-setting-title">{field.type === "shortcut" ? <IconKeyboard size={14} aria-hidden="true" /> : null}<span>{field.title}</span></div>
        {field.description ? <p className="plugins-setting-description">{field.description}</p> : null}
        {field.type === "shortcut" ? <span className="plugins-setting-scope">{t("plugins.settingsPluginScope")}</span> : null}</div>
      <div className="plugins-setting-control"><SettingControl setting={field} value={draft[field.key]} disabled={saving} onChange={(value) => change(field.key, value)} />
        <button type="button" className="plugins-setting-reset" disabled={saving} onClick={() => change(field.key, initialValue({ ...field, value: undefined }))}>{t("plugins.settingsReset")}</button></div>
    </div>)}</div>
    {error ? <p className="plugins-settings-error" role="alert">{error}</p> : null}
    <div className="plugins-modal-actions"><Button disabled={saving} onClick={() => setSettingsPlugin(null)}>{t("plugins.cancel")}</Button>
      <Button variant="primary" disabled={saving} onClick={() => void save()}>{t(saving ? "settings.saving" : "plugins.settingsSave")}</Button></div>
  </div></div>;
}
