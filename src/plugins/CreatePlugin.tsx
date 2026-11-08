import { useFeedback, localized, t, useTranslation } from "../i18n";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { PluginTemplate, ScaffoldInput } from "./runtimeContracts";
import { pluginError } from "./hostClient";
import { RadioGroup } from "../components/controls/RadioGroup";
import { guardComposingEnter } from "../utils/keyboard";

const TEMPLATES: { id: PluginTemplate; title: string; description: string }[] = localized(() => ([
  { id: "panel-basic", title: t("plugins.CreatePlugin.text_31c8c08b18"), description: t("plugins.CreatePlugin.text_98f3a853c3") },
  { id: "agent-tool-basic", title: t("plugins.CreatePlugin.text_09225fee46"), description: t("plugins.CreatePlugin.text_e6fd7a5580") },
  { id: "skill-pack", title: t("plugins.CreatePlugin.text_b8a4cd5430"), description: t("plugins.CreatePlugin.text_eee48cf047") },
  { id: "full-demo", title: t("plugins.CreatePlugin.text_8b31eba049"), description: t("plugins.CreatePlugin.text_dd4cc802b4") },
]));
export function CreatePlugin({ busy, onCreate, onCancel }: { busy: boolean; onCreate: (input: ScaffoldInput) => Promise<void>; onCancel: () => void }) {
  useTranslation();
  const [template, setTemplate] = useState<PluginTemplate>("panel-basic");
  const [name, setName] = useState(t("plugins.CreatePlugin.text_1b70686b64")), [id, setId] = useState("local.my-plugin");
  const [parent, setParent] = useState(""), [error, setError] = useFeedback("");
  const [choosing, setChoosing] = useState(false);
  const locked = busy || choosing;
  async function choose() {
    setChoosing(true); setError("");
    try { const path = await open({ directory: true, multiple: false, title: t("plugins.CreatePlugin.text_09bd2964a8") }); if (typeof path === "string") setParent(path); }
    catch (reason) { setError(() => pluginError(reason)); } finally { setChoosing(false); }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!parent || locked) return;
    if (!name.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
      setError(() => t("plugins.CreatePlugin.text_485f89292e")); return;
    }
    const separator = parent.includes("\\") ? "\\" : "/";
    void onCreate({ directory: `${parent.replace(/[\\/]$/, "")}${separator}${id}`, template, id, name });
  }
  return <form onKeyDown={guardComposingEnter} className="plugins-create" onSubmit={submit} noValidate aria-label={t("plugins.CreatePlugin.text_6001a3355a")}>
    <div><span className="plugins-eyebrow">{t("plugins.CreatePlugin.text_2c0aaf6511")}</span><h3>{t("plugins.CreatePlugin.text_92e5c9c797")}</h3><p>{t("plugins.CreatePlugin.text_2a5df455e2")}</p></div>
    <fieldset disabled={locked}><legend>{t("plugins.CreatePlugin.text_a3623cdcb7")}</legend><RadioGroup<PluginTemplate> value={template} onChange={setTemplate}
      ariaLabel={t("plugins.CreatePlugin.text_a3623cdcb7")} disabled={locked} options={TEMPLATES.map((item) => ({ value: item.id, label: item.title, description: item.description }))} /></fieldset>
    <div className="plugins-form-row"><label>{t("plugins.CreatePlugin.text_e148916839")}<input value={name} disabled={locked} onChange={(event) => setName(event.target.value)} aria-required="true" maxLength={128} /></label>
      <label>{t("plugins.CreatePlugin.text_aa2b9832da")}<input value={id} disabled={locked} onChange={(event) => setId(event.target.value)} aria-required="true" maxLength={128} /></label></div>
    <div className="plugins-folder"><button disabled={locked} onClick={() => void choose()} type="button">{t("plugins.CreatePlugin.text_edfa33a3f4")}</button><span className="plugins-path">{parent ? `${parent} / ${id}` : t("plugins.CreatePlugin.text_def3db9af7")}</span></div>
    {error ? <p role="alert" className="plugins-panel__error">{error}</p> : null}
    <div className="plugins-actions"><button disabled={locked} onClick={onCancel} type="button">{t("plugins.CreatePlugin.text_2cd0f3be87")}</button><button className="plugins-primary" disabled={locked || !parent || !name.trim() || !id.trim()} type="submit">{t("plugins.CreatePlugin.text_bdd5dbc506")}</button></div>
  </form>;
}
