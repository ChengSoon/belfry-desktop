import { formatList, t, useTranslation } from "../i18n";
import type { DirectoryManifest, InstallPreview } from "./hostContracts";
export function ManifestDetails({ manifest }: { manifest: DirectoryManifest }) {
  useTranslation();
  const c = manifest.contributes;
  const runtime = manifest.runtime?.contributes;
  const counts = [[c.commands.length, "commands"], [c.skills.length, "skills"], [c.settings.length, "settings"],
    [runtime?.agentTools?.length, "tools"], [runtime?.views?.length, "views"], [runtime?.themes?.length, "themes"],
    [runtime?.services?.length, "services"], [runtime?.mcpServers?.length, "mcp"]] as const;
  return <dl className="plugins-details">
    <dt>{t("plugins.PluginDetails.text_7d4146ca08")}</dt><dd>{manifest.author || t("plugins.PluginDetails.text_756762e293")}</dd>
    <dt>{t("plugins.PluginDetails.text_e1ba8151b2")}</dt><dd>{manifest.runtime ? t("plugins.PluginDetails.text_c21bebf955", { version: manifest.runtime.engines?.piDesktop ?? "schemaVersion 1" }) : t(manifest.compatibility.maxAppVersionExclusive ? "plugins.PluginDetails.versionRange" : "plugins.PluginDetails.minimumVersion", { min: manifest.compatibility.minAppVersion, max: manifest.compatibility.maxAppVersionExclusive, api: manifest.compatibility.pluginApi })}</dd>
    <dt>{t("plugins.PluginDetails.text_978cbca626")}</dt><dd>{manifest.permissions.join(" · ") || t("plugins.PluginDetails.text_484d556139")}</dd>
    <dt>{t("plugins.PluginDetails.text_0de5539bc1")}</dt><dd>{formatList(counts.filter(([count]) => count !== undefined).map(([count, kind]) => t(`plugins.PluginDetails.count.${kind}`, { count })))}</dd>
    {manifest.runtime?.fs ? <><dt>{t("plugins.PluginDetails.text_39932f24fe")}</dt><dd>{formatList(Object.entries(manifest.runtime.fs).map(([mode, rule]) => `${mode}: ${rule.root ?? "workspace"} / ${rule.scope?.length ? formatList(rule.scope) : t("plugins.PluginDetails.text_484d556139")}`))}</dd></> : null}
    {manifest.runtime?.net?.domains ? <><dt>{t("plugins.PluginDetails.text_97b31b5d63")}</dt><dd>{formatList(manifest.runtime.net.domains)}</dd></> : null}
  </dl>;
}
export function PreviewCard({ preview, busy, canInstall, onConfirm, onCancel }: { preview: InstallPreview; busy: boolean; canInstall: boolean; onConfirm: () => void; onCancel: () => void }) {
  useTranslation();
  return <section className="plugins-preview" aria-labelledby="plugin-preview-title">
    <div className="plugins-panel__head"><div><span className="plugins-eyebrow">{t("plugins.PluginDetails.text_f6b24f5fe2")}</span><h3 id="plugin-preview-title">{preview.manifest.name} <small>{preview.manifest.version}</small></h3></div><span className="plugins-badge">{preview.development ? t("plugins.PluginDetails.text_11f77b0847") : t("plugins.PluginDetails.text_9f6b8daab6")}</span></div>
    <p>{preview.manifest.description}</p><ManifestDetails manifest={preview.manifest} />
    <p className="plugins-path">{t("plugins.PluginDetails.text_d4aecbca21", { sourcePath: preview.sourcePath })}</p>
    <p>{t("plugins.PluginDetails.installSummary", { count: preview.fileCount, kilobytes: Math.ceil(preview.totalBytes / 1024) })}</p>
    <p>{t(preview.development ? "plugins.PluginDetails.developmentInstall" : "plugins.PluginDetails.managedInstall")}</p>
    {preview.manifest.runtime ? <p>{t("plugins.PluginDetails.text_24fcbae062")}</p> : null}
    <div className="plugins-actions"><button disabled={busy} onClick={onCancel} type="button">{t("plugins.PluginDetails.text_2cd0f3be87")}</button><button className="plugins-primary" disabled={busy || !canInstall} onClick={onConfirm} type="button">{t("plugins.PluginDetails.text_f03d180205")}</button></div>
  </section>;
}
