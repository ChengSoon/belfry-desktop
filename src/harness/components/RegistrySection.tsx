import { useFeedback, getLocale, t, useTranslation } from "../../i18n";
import { Presence } from "../../components/motion/Presence";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { HarnessRegistryClient, type HarnessInstallPreview, type HarnessPlugin, type HarnessRegistryState } from "../registryClient";
import "./registrySection.css";
import { ConfirmDialog } from "../../components/ConfirmDialog";

const APP_VERSION = "0.19.0";
export type RegistryAction = "disable" | "uninstall";
const defaultClient = new HarnessRegistryClient();

export function RegistrySection({ client = defaultClient }: { client?: HarnessRegistryClient }) {
  useTranslation();
  const [registry, setRegistry] = useState<HarnessRegistryState | null>(null);
  const [error, setError] = useFeedback<string>();
  const [busy, setBusy] = useState<string>();
  const [preview, setPreview] = useState<HarnessInstallPreview>();
  const [pending, setPending] = useState<{ action: RegistryAction; plugin: HarnessPlugin } | null>(null);
  const load = useCallback(async () => {
    setError(undefined);
    try { setRegistry(await client.list()); }
    catch { setError(() => t("harness.RegistrySection.text_200f3ccfec")); }
  }, [client]);
  useEffect(() => { void load(); }, [load]);

  const mutate = async (action: RegistryAction, plugin: HarnessPlugin) => {
    if (!registry || busy) return;
    setBusy(plugin.pluginId); setError(undefined);
    try {
      const next = action === "disable"
        ? await client.disable(registry.revision, plugin.pluginId)
        : await client.uninstall(registry.revision, plugin.pluginId);
      setRegistry(next);
    } catch (failure) {
      setError(isRevisionConflict(failure) ? t("harness.RegistrySection.text_07eab2da17") : t("harness.RegistrySection.text_b5fc584365"));
      if (isRevisionConflict(failure)) await load();
    } finally { setBusy(undefined); }
  };

  const plugins = useMemo(() => registry?.plugins ?? [], [registry, getLocale()]);
  const selectImport = async () => {
    const manifestPath = await openDialog({ multiple: false, directory: false, filters: [{ name: "Harness manifest", extensions: ["json"] }] });
    if (typeof manifestPath !== "string") return;
    const workerPath = await openDialog({ multiple: false, directory: false, title: t("harness.RegistrySection.text_5ec5d942db") });
    if (typeof workerPath !== "string") return;
    setBusy("install"); setError(undefined);
    try { setPreview(await client.previewInstall(manifestPath, workerPath)); }
    catch { setError(() => t("harness.RegistrySection.text_f8b3e8502c")); }
    finally { setBusy(undefined); }
  };
  const finishImport = async (approve: boolean) => {
    if (!preview) return;
    const selected = preview; setPreview(undefined); setBusy("install");
    try {
      if (approve) setRegistry(await client.commitInstall(selected.previewId));
      else await client.cancelInstall(selected.previewId);
    } catch (failure) {
      setError(isRevisionConflict(failure) ? t("harness.RegistrySection.text_ea2ac667d3") : t("harness.RegistrySection.text_54ec5f5e0c"));
      await load();
    } finally { setBusy(undefined); }
  };
  return (
    <section aria-labelledby="harness-registry-title" className="harness-registry">
      <header className="harness-registry__head">
        <div><h2 id="harness-registry-title">Harness Registry</h2><p>{t("harness.RegistrySection.text_0029b50eea")}</p></div>
        <div className="harness-registry__actions"><button disabled={Boolean(busy)} onClick={() => void selectImport()} type="button">{t("harness.RegistrySection.text_a74010990f")}</button><button aria-label={t("harness.RegistrySection.text_4e5093940c")} disabled={Boolean(busy)} onClick={() => void load()} type="button"><RefreshCw aria-hidden="true" size={14} />{t("harness.RegistrySection.text_aee8874341")}</button></div>
      </header>
      <aside className="harness-registry__notice"><ShieldCheck aria-hidden="true" size={16} /><span><strong>{t("harness.RegistrySection.text_40a0299a14")}</strong><br />{t("harness.RegistrySection.text_5a21213899")}</span></aside>
      <div aria-live="polite" className="harness-registry__meta">Revision <code>{registry?.revision ?? "—"}</code></div>
      {error ? <p className="harness-registry__error" role="alert">{error}</p> : null}
      {preview ? <aside className="harness-registry__preview" aria-label={t("harness.RegistrySection.text_bd1fd5be61")}>
        <strong>{preview.pluginId} v{preview.version}</strong>
        <p>{t("harness.RegistrySection.text_d11158852e", { status: preview.capabilities.join(" · ") || t("harness.RegistrySection.text_484d556139") })}</p>
        <p>Worker digest: <code>{preview.workerDigest}</code></p>
        <p className="harness-registry__warning">{t("harness.RegistrySection.text_886e0a9fd7")}</p>
        <div className="harness-registry__actions"><button onClick={() => void finishImport(false)} type="button">{t("harness.RegistrySection.text_2cd0f3be87")}</button><button onClick={() => void finishImport(true)} type="button">{t("harness.RegistrySection.text_a0f42f891d")}</button></div>
      </aside> : null}
      {!registry && !error ? <p className="harness-registry__empty">{t("harness.RegistrySection.text_530719af53")}</p> : null}
      {registry && plugins.length === 0 ? <p className="harness-registry__empty">{t("harness.RegistrySection.text_73281bfbbc")}</p> : null}
      {plugins.length ? <ul className="harness-registry__list">{plugins.map((plugin) => {
        const status = pluginStatus(plugin);
        return <li key={plugin.pluginId}>
          <div className="harness-registry__identity"><strong>{plugin.pluginId}</strong><span>v{plugin.version}</span></div>
          <div className="harness-registry__badges"><span data-tone={status.trusted ? "ok" : "warn"}>{status.trusted ? t("harness.RegistrySection.text_53aa8fb4c6") : t("harness.RegistrySection.text_86cc571e10")}</span><span data-tone={status.compatible ? "ok" : "warn"}>{status.compatible ? t("harness.RegistrySection.text_e1ba8151b2") : t("harness.RegistrySection.text_4ae9eb2874")}</span><span>{status.enabled ? t("harness.RegistrySection.text_dfb802238b") : t("harness.RegistrySection.text_bc5a87a757")}</span></div>
          <p>{plugin.capabilities.length ? plugin.capabilities.join(" · ") : t("harness.RegistrySection.text_febaf9999e")}</p>
          <div className="harness-registry__actions"><button disabled title={t("harness.RegistrySection.text_071f2d7980")} type="button">{t("harness.RegistrySection.text_3055a035f0")}</button><button disabled={!plugin.enabled || !!busy} onClick={() => setPending({ action: "disable", plugin })} type="button">{t("harness.RegistrySection.text_7df5c456c7")}</button><button disabled={!!busy} onClick={() => setPending({ action: "uninstall", plugin })} type="button">{t("harness.RegistrySection.text_06bc14b60f")}</button></div>
        </li>;
      })}</ul> : null}
      <Presence open={!!pending}>
      {pending ? <ConfirmDialog title={pending.action === "disable" ? t("harness.RegistrySection.text_a2a29547ec") : t("harness.RegistrySection.text_30c0ce724d")}
        body={confirmText(pending.action, pending.plugin.pluginId)} confirmLabel={pending.action === "disable" ? t("harness.RegistrySection.text_7df5c456c7") : t("harness.RegistrySection.text_06bc14b60f")}
        onCancel={() => setPending(null)} onConfirm={() => { setPending(null); void mutate(pending.action, pending.plugin); }} /> : null}
      </Presence>
    </section>
  );
}

export function pluginStatus(plugin: HarnessPlugin) {
  return { trusted: plugin.trusted, enabled: plugin.enabled, compatible: plugin.harnessApi === 1 && compareVersions(plugin.minAppVersion, APP_VERSION) <= 0 };
}
export function isRevisionConflict(value: unknown) { return typeof value === "object" && value !== null && "code" in value && value.code === "REVISION_CONFLICT"; }
export function confirmText(action: RegistryAction, pluginId: string) { return action === "disable" ? t("harness.RegistrySection.text_60a1c8ae9b", { pluginId: pluginId }) : t("harness.RegistrySection.text_7e4979e587", { pluginId: pluginId }); }
function compareVersions(left: string, right: string) { const a = left.split(".").map(Number); const b = right.split(".").map(Number); for (let i = 0; i < 3; i += 1) { if (a[i] !== b[i]) return (a[i] ?? 0) - (b[i] ?? 0); } return 0; }
