import { useFeedback, t, useTranslation } from "../../i18n";
import { useEffect, useState } from "react";
import { usePluginsPage } from "./context";
import { Button, Textarea } from "./ui";
import { useModal } from "./useModal";
import { centerApi } from "./api";
import { pluginHost } from "../useDirectoryRegistry";
import { pluginError } from "../hostClient";
import { pluginNotice } from "../notices";
import { PermissionChips } from "./PermissionChips";
import type { PluginCheck } from "../runtimeContracts";

export function PublishDialog({ directory }: { directory: string }) {
  useTranslation();
  const { actions, data, market, setTab, setPublishDirectory } = usePluginsPage();
  const [checked, setChecked] = useState<PluginCheck | null>(null), [error, setError] = useFeedback("");
  const [changelog, setChangelog] = useState("");
  const ref = useModal(() => setPublishDirectory(null), actions.busy);
  useEffect(() => {
    let live = true;
    void pluginHost.check(directory).then((value) => { if (live) setChecked(value); }).catch((reason) => { if (live) setError(() => pluginError(reason)); });
    return () => { live = false; };
  }, [directory]);
  const publish = () => actions.run(async () => {
    if (!checked) return;
    const result = await centerApi.publish({ directory, changelog, expectedDigest: checked.digest });
    const settings = { ...data.management.settings, pluginMarketSource: "personal" as const };
    await centerApi.setSource(settings); data.setManagement((current) => ({ ...current, settings }));
    setTab("market"); await market.refresh(true); setPublishDirectory(null);
    pluginNotice(t("plugins.PublishDialog.text_06312e138f", { id: result.id, version: result.version }));
  });
  return <div className="plugins-modal-backdrop" ref={ref}><div className="plugins-modal" role="dialog" aria-modal="true" aria-label={t("plugins.PublishDialog.text_dcdb7c97ad")}>
    <header className="plugins-modal-head"><div><h2 className="plugins-modal-title">{t("plugins.PublishDialog.text_b506e55730")}</h2>
      <p className="plugins-modal-subtitle">{t("plugins.PublishDialog.text_b16a0e2dc5")}</p></div></header>
    <div className="plugins-modal-body">
      {checked ? <><h3 className="plugins-publish-name">{checked.manifest.name} <span>v{checked.manifest.version}</span></h3>
        <p className="plugins-author-hint">{t("plugins.PublishDialog.text_c0709f85c9", { id: checked.manifest.id, count: checked.fileCount })}</p>
        <PermissionChips permissions={checked.manifest.permissions ?? []} />
        <label className="plugins-author-field"><span>{t("plugins.PublishDialog.text_0ff983ee83")}</span><Textarea rows={3} maxLength={16_384} value={changelog} disabled={actions.busy}
          onChange={(event) => setChangelog(event.target.value)} placeholder={t("plugins.PublishDialog.text_7e1812631a")} /></label>
        <p className="plugins-author-hint">{t("plugins.PublishDialog.text_cb49df5a00")}</p>
      </> : !error ? <p role="status">{t("plugins.PublishDialog.text_b3d59d2d95")}</p> : null}
      {error || actions.error ? <p className="plugins-inline-error" role="alert">{error || actions.error}</p> : null}
    </div><footer className="plugins-modal-actions"><Button disabled={actions.busy} onClick={() => setPublishDirectory(null)}>{t("plugins.PublishDialog.text_2cd0f3be87")}</Button>
      <Button variant="primary" disabled={!checked || actions.busy} onClick={() => void publish()}>{actions.busy ? t("plugins.PublishDialog.text_d8d0b8678a") : t("plugins.PublishDialog.text_dcdb7c97ad")}</Button></footer>
  </div></div>;
}
