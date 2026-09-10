// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { IconCheck, IconShield, IconX } from "./icons";
import { Button } from "./ui";
import { t } from "./i18n";
import { formatBytes, formatDate, monogram, orderPermissions, showsVerifiedBadge, versionInstallable } from "./helpers";
import { useModal } from "./useModal";
import { MarketDetailBody } from "./MarketDetailBody";

export function MarketDetail() {
  const { detail: state, actions } = usePluginsPage();
  const ref = useModal(state.close, !!actions.pending);
  const { detail, selectedId } = state;
  return <div className="plugins-sheet-layer" ref={ref}>
    <button type="button" className="plugins-sheet-scrim" aria-label={t("plugins.closeDetail")} onClick={state.close} />
    <aside className="plugins-sheet" role="dialog" aria-modal="true" aria-label={t("plugins.detailTitle")}>
      <header className="plugins-sheet-head"><span className="plugins-card-glyph is-large" aria-hidden>{monogram(detail?.name || selectedId || "")}</span>
        <div className="plugins-sheet-ident"><h2 className="plugins-sheet-title">{detail?.name || selectedId}
          {showsVerifiedBadge(detail) ? <span className="plugins-verified" title={t("plugins.verified")} aria-label={t("plugins.verified")}><IconShield size={12} /></span> : null}</h2>
          <div className="plugins-sheet-meta"><span className="plugins-row-id">{detail?.id || selectedId}</span>
            {detail?.author ? <><span className="plugins-dot" aria-hidden>·</span><span>{detail.author}</span></> : null}</div></div>
        <button type="button" className="plugins-icon-btn" aria-label={t("plugins.closeDetail")} title={t("plugins.closeDetail")} onClick={state.close}><IconX size={15} /></button>
      </header>
      {state.loading ? <div className="plugins-sheet-state">{t("plugins.detailLoading")}</div> : !detail ?
        <div className="plugins-sheet-state" role="alert">{state.error || t("plugins.detailFailed")}</div> : <><DetailInstall /><MarketDetailBody detail={detail} /></>}
    </aside>
  </div>;
}
function DetailInstall() {
  const { detail: state, data, actions } = usePluginsPage();
  const detail = state.detail!;
  const version = state.activeVersion, target = version?.version || detail.latestVersion;
  const installed = data.plugins.find((plugin) => plugin.id === detail.id);
  const pending = !versionInstallable(version), withdrawn = version?.yanked === true;
  const permissions = orderPermissions(version?.permissions ?? detail.permissions);
  return <div className="plugins-sheet-cta"><div className="plugins-sheet-cta-copy">
    <span className="plugins-sheet-cta-version">v{target}</span><span className="plugins-sheet-cta-meta">
      {withdrawn ? t("plugins.withdrawnHint", { version: target }) : pending ? t("plugins.packagePendingHint", { version: target }) : <>
        {formatDate(version?.publishedAt)}{version?.sizeBytes ? <><span className="plugins-dot" aria-hidden>·</span>{formatBytes(version.sizeBytes)}</> : null}</>}
    </span></div>
    {installed?.version === target ? <span className="plugins-installed-mark"><IconCheck size={13} />{t("plugins.installedLabel")}</span> :
      <Button variant="primary" disabled={actions.busy || pending} onClick={() => actions.queueInstall({ id: detail.id, name: detail.name, version: target, permissions,
        newPermissions: installed ? permissions.filter((permission) => !installed.permissions.includes(permission)) : [] })}>
        {installLabel({ withdrawn, pending, busy: actions.busy, installed: !!installed, target })}
      </Button>}
  </div>;
}
function installLabel({ withdrawn, pending, busy, installed, target }: { withdrawn: boolean; pending: boolean; busy: boolean; installed: boolean; target: string }) {
  if (withdrawn) return t("plugins.withdrawn");
  if (pending) return t("plugins.packagePending");
  if (busy) return t("plugins.installing");
  return installed ? t("plugins.updateNow") : t("plugins.installVersion", { version: target });
}
