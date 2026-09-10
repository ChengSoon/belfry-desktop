// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { IconCheck, IconLink, IconTriangleAlert } from "./icons";
import { cx } from "./ui";
import { t } from "./i18n";
import { formatBytes, formatDate, orderPermissions, shortSha, versionInstallable } from "./helpers";
import { PermissionList } from "./PermissionChips";
import { centerApi } from "./api";
import { Markdown } from "./Markdown";
import type { MarketPluginDetail } from "./types";

export function MarketDetailBody({ detail }: { detail: MarketPluginDetail }) {
  const { detail: state } = usePluginsPage();
  const permissions = orderPermissions(state.activeVersion?.permissions ?? detail.permissions);
  return <div className="plugins-sheet-body">
    <section className="plugins-sheet-section"><h3 className="plugins-sheet-section-title">{t("plugins.aboutTitle")}</h3>
      <p className="plugins-sheet-desc">{detail.description}</p><div className="plugins-sheet-links">
        {detail.repository ? <SourceLink label={t("plugins.repository")} url={detail.repository} /> : null}
        {detail.homepage ? <SourceLink label={t("plugins.homepage")} url={detail.homepage} /> : null}</div>
    </section><DetailProvenance />
    {detail.safetyNotes ? <section className="plugins-callout"><span className="plugins-callout-icon" aria-hidden><IconTriangleAlert size={15} /></span>
      <div><h3 className="plugins-callout-title">{t("plugins.safetyNotes")}</h3><p className="plugins-callout-body">{detail.safetyNotes}</p></div></section> : null}
    <section className="plugins-sheet-section"><h3 className="plugins-sheet-section-title">{t("plugins.permissionsTitle")}</h3>
      {permissions.length ? <PermissionList permissions={permissions} /> : <p className="plugins-sheet-desc">{t("plugins.noPermissions")}</p>}</section>
    <DetailVersions detail={detail} />
    <section className="plugins-sheet-section"><h3 className="plugins-sheet-section-title">{t("plugins.readme")}</h3>
      {detail.readmeMarkdown ? <div className="plugins-readme"><Markdown source={detail.readmeMarkdown} /></div> : <p className="plugins-sheet-desc">{t("plugins.readmeEmpty")}</p>}</section>
  </div>;
}
function SourceLink({ label, url }: { label: string; url: string }) {
  const { actions } = usePluginsPage();
  return <button type="button" className="plugins-sheet-link" onClick={() => void actions.run(() => centerApi.openExternal(url))}>
    <IconLink size={13} /><span className="plugins-sheet-link-label">{label}</span><span className="plugins-sheet-link-url">{url}</span></button>;
}
function DetailProvenance() {
  const { detail: state } = usePluginsPage(), provenance = state.activeVersion?.provenance;
  if (!provenance?.sourceRepository) return null;
  return <section className="plugins-sheet-section"><h3 className="plugins-sheet-section-title">{t("plugins.sourceTitle")}</h3>
    <div className="plugins-sheet-links"><SourceLink label={t("plugins.repository")} url={provenance.sourceRepository} /></div>
    <dl className="plugins-provenance">{provenance.sourceCommit ? <div className="plugins-provenance-row"><dt>{t("plugins.sourceCommit")}</dt>
      <dd><code title={provenance.sourceCommit}>{shortSha(provenance.sourceCommit)}</code></dd></div> : null}
      {provenance.builder ? <div className="plugins-provenance-row"><dt>{t("plugins.sourceBuiltBy")}</dt><dd>{provenance.builder}</dd></div> : null}</dl>
  </section>;
}
function DetailVersions({ detail }: { detail: MarketPluginDetail }) {
  const { detail: state } = usePluginsPage();
  return <section className="plugins-sheet-section"><h3 className="plugins-sheet-section-title">{t("plugins.versions")}
    <span className="plugins-sheet-section-hint">{t("plugins.selectVersion")}</span></h3><div className="plugins-version-list">
    {detail.versions.map((version) => {
      const active = state.activeVersion?.version === version.version, withdrawn = version.yanked, pending = !withdrawn && !versionInstallable(version);
      return <button key={version.version} type="button" className={cx("plugins-version", active && "active", withdrawn && "withdrawn")}
        aria-pressed={active} onClick={() => state.setVersion(version.version)}>
        <span className="plugins-version-mark" aria-hidden>{active ? <IconCheck size={12} /> : null}</span><span className="plugins-version-copy">
          <span className="plugins-version-top"><strong>v{version.version}</strong><span>{formatDate(version.publishedAt)}</span></span>
          <span className="plugins-version-meta">{withdrawn ? <span className="plugins-version-withdrawn">{t("plugins.withdrawn")}</span> : pending ? <span className="plugins-version-pending">{t("plugins.packagePending")}</span> : <>
            {formatBytes(version.sizeBytes)}<span className="plugins-dot" aria-hidden>·</span><code title={version.shasum}>{shortSha(version.shasum)}</code></>}</span>
          {withdrawn && version.yankedReason ? <span className="plugins-version-changelog">{t("plugins.withdrawnReason", { reason: version.yankedReason })}</span> : version.changelog ? <span className="plugins-version-changelog">{version.changelog}</span> : null}
        </span></button>;
    })}
  </div></section>;
}
