import { useFeedback, TranslationError, t, useTranslation } from "../i18n";
import { useState } from "react";
import type { DirectoryRegistry } from "./hostContracts";
import { pluginHost } from "./useDirectoryRegistry";
import { pluginError } from "./hostClient";
import { staticCatalog } from "./staticCatalog";
export function ContributionBrowser({ registry }: { registry: DirectoryRegistry | null }) {
  useTranslation();
  const catalog = staticCatalog(registry);
  const [notice, setNotice] = useFeedback("");
  const [busy, setBusy] = useState(false);
  async function copy(pluginId: string, id: string, kind: "command" | "skill") {
    if (busy) return; setBusy(true);
    try {
      const fresh = await pluginHost.list();
      const current = staticCatalog(fresh);
      const text = kind === "skill" ? await pluginHost.skill(pluginId, id) : current.commands.find((c) => c.pluginId === pluginId && c.id === id)?.text;
      if (text === undefined) throw new TranslationError("plugins.ContributionBrowser.text_a0b82ad735");
      await navigator.clipboard.writeText(text); setNotice(() => t("plugins.ContributionBrowser.text_fec43bbb02"));
    } catch (reason) { setNotice(() => pluginError(reason)); } finally { setBusy(false); }
  }
  if (!Object.values(catalog).some((items) => items.length)) return null;
  return <section className="plugins-contributions" aria-label={t("plugins.ContributionBrowser.text_8d0993debc")}>
    <h3>{t("plugins.ContributionBrowser.text_8d0993debc")}</h3><p>{t("plugins.ContributionBrowser.text_45aa793ef9")}</p>
    {catalog.commands.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{t("plugins.ContributionBrowser.text_40bc7b835c", { pluginName: item.pluginName })}</small><pre>{item.text}</pre></div><button disabled={busy} onClick={() => void copy(item.pluginId, item.id, "command")} type="button">{t("plugins.ContributionBrowser.text_605c82dd96")}</button></article>)}
    {catalog.skills.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{item.pluginName} · Skill</small></div><button disabled={busy} onClick={() => void copy(item.pluginId, item.id, "skill")} type="button">{t("plugins.ContributionBrowser.text_e399c75bee")}</button></article>)}
    {catalog.settings.map((item) => <article key={item.key}><div><strong>{item.title}</strong><small>{t("plugins.ContributionBrowser.text_08f8acd24e", { pluginName: item.pluginName })}</small><p>{item.description}</p></div><code>{item.default}</code></article>)}
    <p role="status">{notice}</p>
  </section>;
}
