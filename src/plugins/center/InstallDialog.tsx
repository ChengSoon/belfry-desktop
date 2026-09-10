// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { IconShield, IconTriangleAlert } from "./icons";
import { Button, cx } from "./ui";
import { t } from "./i18n";
import { permissionRisk, RISK_LABEL_KEYS, RISK_TIERS } from "./helpers";
import { PermissionList, FsScopeChips } from "./PermissionChips";
import { cancelInstall, confirmInstall } from "./useCenterActions";
import { useModal } from "./useModal";
import type { PluginFsPolicy } from "./types";

export function InstallDialog() {
  const { actions } = usePluginsPage(), pending = actions.pending!;
  const ref = useModal(() => void cancelInstall(actions), actions.busy);
  return <div className="plugins-modal-backdrop" role="presentation" ref={ref}><div className="plugins-modal" role="dialog" aria-modal="true" aria-label={t("plugins.permissionReview")}>
    <header className="plugins-modal-head"><span className="plugins-modal-icon" aria-hidden><IconShield size={17} /></span>
      <div><h2 className="plugins-modal-title">{t("plugins.permissionReviewTitle", { name: pending.name })}</h2>
        {pending.version ? <p className="plugins-modal-subtitle">{t("plugins.installingVersion", { version: pending.version })}</p> : null}</div></header>
    <InstallPermissions />
    {pending.market ? <div className="plugins-switch-row"><span className="plugins-switch-label">{t("plugins.enableAutoUpdateOnInstall")}</span>
      <button type="button" className={cx("settings-toggle", actions.autoUpdate && "on")} role="switch" aria-checked={actions.autoUpdate}
        aria-label={t("plugins.enableAutoUpdateOnInstall")} disabled={actions.busy} onClick={() => actions.setAutoUpdate(!actions.autoUpdate)}><span className="settings-toggle-thumb" /></button></div> : null}
    {actions.error ? <p className="plugins-settings-error" role="alert">{actions.error}</p> : null}
    <div className="plugins-modal-actions"><Button disabled={actions.busy} onClick={() => void cancelInstall(actions)}>{t("plugins.cancel")}</Button>
      <Button variant="primary" disabled={actions.busy} onClick={() => void confirmInstall(actions)}>{t(actions.busy ? "plugins.installing" : "plugins.acceptInstall")}</Button></div>
  </div></div>;
}
function InstallPermissions() {
  const { actions } = usePluginsPage(), pending = actions.pending!;
  return <div className="plugins-modal-body"><p className="plugins-modal-lede">{t("plugins.permissionReviewBody")}</p>
    {pending.preview && !pending.market ? <p className="plugins-modal-lede">{pending.preview.sourcePath}</p> : null}
    {!pending.permissions.length ? <p className="plugins-modal-lede">{t("plugins.noPermissions")}</p> : RISK_TIERS.map((tier) => {
      const scoped = pending.permissions.filter((permission) => permissionRisk(permission) === tier);
      if (!scoped.length) return null;
      return <div key={tier} className={cx("plugins-risk-group", `risk-${tier}`)}><div className="plugins-risk-head">
        {tier === "high" ? <IconTriangleAlert size={13} /> : <IconShield size={13} />}{t(RISK_LABEL_KEYS[tier])}<span className="plugins-risk-count">{scoped.length}</span></div>
        <PermissionList permissions={scoped} added={pending.newPermissions} plain /></div>;
    })}
    {pending.preview?.manifest.runtime?.fs ? <FsScopeChips policy={pending.preview.manifest.runtime.fs as PluginFsPolicy} /> : null}
  </div>;
}
