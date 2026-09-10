import { useEffect, useState } from "react";
import type { PiSetting } from "./runtimeContracts";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { parseSettingDraft, settingDraft } from "./settingDraft";

export function PluginSettings({ pluginId, settings }: { pluginId: string; settings: PiSetting[] }) {
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    setValues(null); setDraft({});
    void pluginHost.getSettings(pluginId).then((result) => { if (live) setValues(result); }).catch((error) => { if (live) setNotice(pluginError(error)); });
    return () => { live = false; };
  }, [pluginId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (busy || !values) return;
    setBusy(true); setNotice("");
    try {
      const partial = Object.fromEntries(settings.filter((setting) => Object.hasOwn(draft, setting.key)).map((setting) => [setting.key, parseSettingDraft(setting, draft[setting.key])]));
      setValues(await pluginHost.setSettings(pluginId, partial)); setDraft({}); setNotice("设置已保存");
    } catch (reason) { setNotice(pluginError(reason)); } finally { setBusy(false); }
  }
  return <form className="plugins-settings" onSubmit={(event) => void save(event)} aria-label="插件设置">
    <h4>插件设置</h4>
    {settings.map((setting) => <label key={setting.key}><span>{setting.title ?? setting.key}</span><SettingInput setting={setting}
      disabled={busy || values === null} value={draft[setting.key] ?? settingDraft(setting, values?.[setting.key] ?? setting.default)}
      onChange={(value) => setDraft((previous) => ({ ...previous, [setting.key]: value }))} /><small>{setting.description}</small></label>)}
    <div className="plugins-actions"><button type="submit" disabled={busy || !values || !Object.keys(draft).length}>保存设置</button><span role="status">{notice}</span></div>
  </form>;
}
function SettingInput({ setting, value, disabled, onChange }: { setting: PiSetting; value: string; disabled: boolean; onChange: (value: string) => void }) {
  if (setting.type === "boolean") return <input type="checkbox" checked={value === "true"} disabled={disabled} onChange={(event) => onChange(String(event.target.checked))} />;
  if (setting.type === "select") return <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}><option value="-1" disabled>请选择</option>{setting.enum?.map((option, index) => <option key={index} value={String(index)}>{option.label}</option>)}</select>;
  if (setting.type === "json") return <textarea value={value} disabled={disabled} rows={4} onChange={(event) => onChange(event.target.value)} spellCheck={false} />;
  return <input type={setting.type === "number" ? "number" : "text"} step={setting.type === "number" ? "any" : undefined} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
}
