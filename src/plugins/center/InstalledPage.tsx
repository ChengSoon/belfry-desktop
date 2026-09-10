// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { GROUP_LABEL_KEYS, installedGroups } from "./helpers";
import { Button, cx } from "./ui";
import { IconChevronDown, IconCircleAlert, IconPlug, IconSearch } from "./icons";
import { t } from "./i18n";
import { inspectLocal } from "./useCenterActions";
import { CapabilityChips, FsScopeChips, PermissionChips, ServiceChips } from "./PermissionChips";
import { PluginRowControls } from "./PluginRowControls";
import type { PluginServiceStatus, PluginSummary } from "./types";

export function InstalledPage() {
  const { data, query } = usePluginsPage();
  const groups = installedGroups(data.plugins, query);
  return <div id="plugins-panel-installed" role="tabpanel" aria-labelledby="plugins-tab-installed" className="plugins-panel">
    {!groups.length ? <InstalledEmpty /> : groups.map((group) => <section key={group.id} className="plugins-group">
      <header className="plugins-group-head"><h2 className="plugins-group-label">{t(GROUP_LABEL_KEYS[group.id])}</h2><span className="plugins-group-count">{group.rows.length}</span></header>
      <div className="plugins-list" role="list" aria-label={t(GROUP_LABEL_KEYS[group.id])}>
        {group.rows.map((plugin) => <InstalledRow key={plugin.id} plugin={plugin} broken={group.id === "attention"} />)}
      </div>
    </section>)}
  </div>;
}
function InstalledEmpty() {
  const { data, setQuery, setTab, setTemplate, actions } = usePluginsPage();
  const hasPlugins = !!data.plugins.length;
  return <div className="plugins-empty"><span className="plugins-empty-icon" aria-hidden>{hasPlugins ? <IconSearch size={18} /> : <IconPlug size={18} />}</span>
    <p className="plugins-empty-title">{t(hasPlugins ? "plugins.noMatches" : "plugins.empty")}</p>
    <div className="plugins-empty-actions">{hasPlugins ? <Button onClick={() => setQuery("")}>{t("plugins.clearSearch")}</Button> : <>
      <Button variant="primary" onClick={() => setTab("market")}>{t("plugins.browseMarket")}</Button>
      <Button disabled={actions.busy} onClick={() => void inspectLocal(actions, true)}>{t("plugins.loadDev")}</Button>
      <Button onClick={() => setTemplate("panel-basic")}>{t("plugins.newFromTemplate")}</Button></>}
    </div>
  </div>;
}
function InstalledRow({ plugin, broken }: { plugin: PluginSummary; broken: boolean }) {
  return <div role="listitem" className={cx("plugins-row", !plugin.enabled && "off", broken && "broken")}>
    <span className="plugins-glyph" aria-hidden>{broken ? <IconCircleAlert size={15} /> : <IconPlug size={15} />}</span>
    <div className="plugins-row-copy"><div className="plugins-row-title"><span className="plugins-row-name">{plugin.name}</span>
      {plugin.source === "dev" ? <span className="plugins-tag">{t("plugins.tagLocal")}</span> : null}</div>
      <div className="plugins-row-meta"><span className="plugins-row-id">{plugin.id}</span><span className="plugins-dot" aria-hidden>·</span><span>v{plugin.version}</span></div>
      {plugin.errorMessage ? <p className="plugins-row-error">{plugin.errorMessage}</p> : null}<PluginRowDetails plugin={plugin} />
    </div><PluginRowControls plugin={plugin} />
  </div>;
}
function PluginRowDetails({ plugin }: { plugin: PluginSummary }) {
  const { data } = usePluginsPage();
  const services: PluginServiceStatus[] = data.runtime.services.filter((s) => s.pluginId === plugin.id).map((s) => ({
    pluginId: s.pluginId, serviceId: s.id, label: s.label ?? s.id, state: s.status as PluginServiceStatus["state"], restarts: s.restarts ?? 0, updatedAt: 0, message: s.message,
  }));
  const rows = [
    { key: "capabilitiesTitle", show: plugin.capabilities?.length, content: <CapabilityChips capabilities={plugin.capabilities} /> },
    { key: "servicesTitle", show: services.length, content: <ServiceChips statuses={services} /> },
    { key: "permissionsTitle", show: plugin.permissions.length, content: <PermissionChips permissions={plugin.permissions} /> },
    { key: "fileAccessTitle", show: plugin.fs && Object.keys(plugin.fs).length, content: <FsScopeChips policy={plugin.fs} /> },
  ].filter((row) => row.show);
  if (!rows.length) return null;
  return <details className="plugins-row-details"><summary className="plugins-row-details-toggle" aria-label={t("plugins.viewDetailsOf", { name: plugin.name })}>
    <IconChevronDown size={13} aria-hidden="true" /><span>{t("plugins.details")}</span></summary>
    <div className="plugins-row-details-body">{rows.map((row) => <div key={row.key} className="plugins-row-detail">
      <span className="plugins-row-detail-label">{t(`plugins.${row.key}`)}</span>{row.content}</div>)}
      {plugin.permissions.some((key) => key.endsWith(".workspace")) ? <p className="plugins-row-detail-note">{t("plugins.legacyFsDowngraded")}</p> : null}
    </div>
  </details>;
}
