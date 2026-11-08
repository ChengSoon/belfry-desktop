import { useFeedback, t, useTranslation } from "../i18n";
import { useState } from "react";
import type { RuntimeCatalog } from "./runtimeContracts";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { localizedText } from "./runtimeCatalog";
import { PluginThemes } from "./PluginThemes";

export function RuntimeContributions({ runtime }: { runtime: RuntimeCatalog }) {
  useTranslation();
  const [busy, setBusy] = useState(false), [notice, setNotice] = useFeedback("");
  async function run(operation: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setNotice("");
    try { const result = await operation(); setNotice(result == null ? t("plugins.RuntimeContributions.text_258692e9b4") : JSON.stringify(result, null, 2)); }
    catch (error) { setNotice(() => pluginError(error)); } finally { setBusy(false); }
  }
  if (![runtime.commands, runtime.tools, runtime.skills, runtime.views, runtime.services, runtime.themes].some((items) => items.length)) return null;
  return <section className="plugins-contributions" aria-label={t("plugins.RuntimeContributions.text_32d422eedc")}><h3>{t("plugins.RuntimeContributions.text_a7dc5d88de")}</h3>
    <PluginThemes themes={runtime.themes} />
    {runtime.commands.map((item) => <article key={`${item.pluginId}:${item.id}`}><div><strong>{item.title}</strong><small>{t("plugins.RuntimeContributions.text_40bc7b835c", { pluginName: item.pluginName })}</small></div><button disabled={busy} onClick={() => void run(() => pluginHost.runCommand(item.pluginId, item.id))} type="button">{t("plugins.RuntimeContributions.text_e53f35dc00")}</button></article>)}
    {runtime.views.map((item) => <article key={`${item.pluginId}:view:${item.id}`}><div><strong>{localizedText(item.title, item.id)}</strong><small>{t("plugins.RuntimeContributions.text_530e814df4", { pluginName: item.pluginName })}</small></div><button disabled={busy} onClick={() => void run(() => pluginHost.openPanel(item.pluginId, item.id))} type="button">{t("plugins.RuntimeContributions.text_90fe84bc30")}</button></article>)}
    {runtime.tools.length || runtime.skills.length ? <p>{t("plugins.RuntimeContributions.text_29416d4586")}</p> : null}
    {runtime.tools.map((item) => <article key={`${item.pluginId}:tool:${item.name}`}><div><strong>{item.name}</strong><small>{t("plugins.RuntimeContributions.text_e4193ff710", { pluginName: item.pluginName })}</small><p>{item.description}</p></div><span className="plugins-badge">{t("plugins.RuntimeContributions.text_1f4273cab1")}</span></article>)}
    {runtime.skills.map((item) => <article key={`${item.pluginId}:skill:${item.id}`}><div><strong>{item.name}</strong><small>{item.pluginName} · Skill</small><p>{item.description}</p></div><button disabled={busy} onClick={() => void run(async () => {
      const text = await pluginHost.requestRuntime<string>("skill", { pluginId: item.pluginId, path: item.path });
      await navigator.clipboard.writeText(text); return t("plugins.RuntimeContributions.text_dbc54ac92c");
    })} type="button">{t("plugins.RuntimeContributions.text_e399c75bee")}</button></article>)}
    {runtime.services.map((item) => <article key={`${item.pluginId}:service:${item.id}`}><div><strong>{item.label ?? item.id}</strong><small>{t("plugins.RuntimeContributions.text_67a5223d47", { pluginName: item.pluginName })}</small></div><span className="plugins-badge plugins-badge--enabled">{item.status === "running" ? t("plugins.RuntimeContributions.text_1f0eb99b7e") : item.status}</span></article>)}
    <pre role="status">{notice}</pre>
  </section>;
}
