import { t, useTranslation } from "../i18n";
import { useState } from "react";
import type { DirectoryEntry, PluginOperation } from "./hostContracts";
import type { RuntimeCatalog } from "./runtimeContracts";
import { ManifestDetails } from "./PluginDetails";
import { PluginSettings } from "./PluginSettings";

interface CardProps {
  entry: DirectoryEntry; busy: boolean; runtime: RuntimeCatalog; onAction: (action: PluginOperation) => void;
  onAuthor: (action: "check" | "pack") => void; onPanel: () => void;
}
export function PluginCard(props: CardProps) {
  useTranslation();
  const { entry, busy, onAction } = props;
  const [removing, setRemoving] = useState(false), [settingsOpen, setSettingsOpen] = useState(false);
  const m = entry.manifest;
  const { ready, status, error } = cardState(props);
  const settings = m.runtime?.contributes?.settings;
  function act(action: PluginOperation) { setRemoving(false); onAction(action); }
  return <li><div className="plugins-panel__head"><div><h3>{m.name} <small>{m.version}</small></h3><p>{m.id} · {m.runtime ? t("plugins.PluginCard.text_439161d3ce") : t("plugins.PluginCard.text_9645014878")}</p></div><span className={`plugins-badge ${ready ? "plugins-badge--enabled" : ""}`}>{status}</span></div>
    <p>{m.description}</p><ManifestDetails manifest={m} /><p className="plugins-path">{t(entry.source === "development" ? "plugins.PluginCard.developmentPath" : "plugins.PluginCard.installedPath", { path: entry.sourcePath })}</p>
    {error ? <p className="plugins-panel__error" role="alert">{error}</p> : null}
    <div className="plugins-actions"><button disabled={busy} onClick={() => act(entry.enabled ? "disable" : "enable")} type="button">{entry.enabled ? t("plugins.PluginCard.text_7df5c456c7") : t("plugins.PluginCard.text_f4f0ead111")}</button><button disabled={busy} onClick={() => act("reload")} type="button">{t("plugins.PluginCard.text_2a6118a5b2")}</button>
      <RuntimeActions {...props} ready={ready} />
      {settings?.length ? <button disabled={busy || !ready} aria-expanded={settingsOpen} onClick={() => setSettingsOpen((open) => !open)} type="button">{t("plugins.PluginCard.text_b1bc554af4")}</button> : null}
      <button disabled={busy} onClick={() => setRemoving(true)} type="button">{t("plugins.PluginCard.text_06bc14b60f")}</button></div>
    {[settingsOpen, ready, settings].every(Boolean) ? <PluginSettings pluginId={m.id} settings={settings!} /> : null}
    {removing ? <RemoveConfirmation entry={entry} busy={busy} cancel={() => setRemoving(false)} confirm={() => act("uninstall")} /> : null}
  </li>;
}
function cardState({ entry, runtime }: CardProps) {
  const process = runtime.plugins.find((item) => item.id === entry.manifest.id);
  const error = entry.error ?? runtime.errors[entry.manifest.id];
  const ready = entry.enabled && (!entry.manifest.runtime || process?.status === "ready") && !error;
  const status = error ? t("plugins.PluginCard.text_65350ffbd5") : !entry.enabled ? t("plugins.PluginCard.text_bc5a87a757") : ready ? enabledLabel(entry) : t("plugins.PluginCard.text_c58918a16a");
  return { ready, status, error };
}
function enabledLabel(entry: DirectoryEntry) { return entry.manifest.runtime ? t("plugins.PluginCard.text_1f0eb99b7e") : t("plugins.PluginCard.text_dfb802238b"); }
function RuntimeActions({ entry, busy, runtime, ready, onPanel, onAuthor }: CardProps & { ready: boolean }) {
  useTranslation();
  if (!entry.manifest.runtime) return null;
  return <>
    {entry.manifest.runtime.ui?.panel ? <button disabled={busy || !ready} onClick={onPanel} type="button">{t("plugins.PluginCard.text_57fc4bf70b")}</button> : null}
    <button disabled={busy || !runtime.available} onClick={() => onAuthor("check")} type="button">{t("plugins.PluginCard.text_41b0af8c5c")}</button>
    <button disabled={busy || !runtime.available} onClick={() => onAuthor("pack")} type="button">{t("plugins.PluginCard.text_a9a49c8173")}</button>
  </>;
}
function RemoveConfirmation({ entry, busy, cancel, confirm }: Pick<CardProps, "entry" | "busy"> & { cancel: () => void; confirm: () => void }) {
  useTranslation();
  return <div className="plugins-remove" role="group" aria-label={t("plugins.PluginCard.text_293f3965f9", { name: entry.manifest.name })}>
    <p>{t(entry.source === "development" ? "plugins.PluginCard.removeDevelopment" : "plugins.PluginCard.removeInstalled")}</p>
    <div className="plugins-actions"><button disabled={busy} onClick={cancel} type="button">{t("plugins.PluginCard.text_2cd0f3be87")}</button>
      <button disabled={busy} onClick={confirm} type="button">{t("plugins.PluginCard.text_4fec200ac3")}</button></div>
  </div>;
}
