import { formatNumber } from "../../i18n";
import { useTranslation } from "../../i18n";
// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { Disclosure } from "../../components/controls/Disclosure";
import { usePluginsPage } from "./context";
import { GROUP_LABEL_KEYS, installedGroups } from "./helpers";
import { Button, cx } from "./ui";
import { SButton, SGroupTitle, SItem, SList, STag } from "../../settings/kit";
import { IconCircleAlert, IconPlug, IconSearch } from "./icons";
import { t } from "./i18n";
import { inspectLocal } from "./useCenterActions";
import { CapabilityChips, FsScopeChips, PermissionChips, ServiceChips } from "./PermissionChips";
import { PluginRowControls } from "./PluginRowControls";
import type { PluginServiceStatus, PluginSummary } from "./types";

export function InstalledPage() {
  useTranslation();
  const { data, query } = usePluginsPage();
  const groups = installedGroups(data.plugins, query);
  const enabled = data.plugins.filter((plugin) => plugin.enabled).length;
  return <div id="plugins-panel-installed" role="tabpanel" aria-labelledby="plugins-tab-installed" className="plugins-panel">
    {!groups.length ? <InstalledEmpty /> : <>
      <SGroupTitle tail={<span>{t("plugins.InstalledPage.summary", { count: formatNumber(data.plugins.length), enabled: formatNumber(enabled) })}</span>}>{t("plugins.tabInstalled")}</SGroupTitle>
      <SList label={t("plugins.tabInstalled")}>
        {groups.flatMap((group) => group.rows.map((plugin) => <InstalledRow key={plugin.id} plugin={plugin} broken={group.id === "attention"} />))}
      </SList>
    </>}
  </div>;
}

/** 开发：新建插件 / 加载本地插件（稿里的「开发」组；入口原在「更多」菜单里，功能不变）。 */
export function DevelopGroup() {
  useTranslation();
  const { actions, setTemplate } = usePluginsPage();
  return <>
    <SGroupTitle>{t("plugins.InstalledPage.develop")}</SGroupTitle>
    <SList>
      <SItem title={t("plugins.newFromTemplate")} hint={t("plugins.InstalledPage.newHint")}><SButton tone="secondary" onClick={() => setTemplate("panel-basic")}>{t("plugins.InstalledPage.create")}</SButton></SItem>
      <SItem title={t("plugins.loadDev")} hint={t("plugins.InstalledPage.loadDevHint")}><SButton disabled={actions.busy} onClick={() => void inspectLocal(actions, true)}>{t("plugins.InstalledPage.choose")}</SButton></SItem>
    </SList>
  </>;
}
function InstalledEmpty() {
  useTranslation();
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
  useTranslation();
  const { data } = usePluginsPage();
  const tools = data.runtime.tools.filter((tool) => tool.pluginId === plugin.id).length;
  const hue = [...plugin.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  return <div role="listitem" className={cx("sk-item plugins-row", !plugin.enabled && "off", broken && "broken")}>
    <span className="plugins-glyph" aria-hidden style={{ background: broken ? undefined : `oklch(0.55 0.11 ${hue})` }}>{broken ? <IconCircleAlert size={15} /> : plugin.name.slice(0, 1)}</span>
    <div className="sk-l">
      <b>{plugin.name}<span className="sk-pill">v{plugin.version}</span>
        {broken ? <STag tone="danger">{t("plugins.InstalledPage.text_bc288c608f")}</STag> : null}
        {plugin.source === "dev" ? <STag>{t("plugins.tagLocal")}</STag> : null}</b>
      <span>{[plugin.description, tools ? t("plugins.InstalledPage.tools", { count: tools }) : null, plugin.id].filter(Boolean).join(" · ")}</span>
      {plugin.errorMessage ? <span className="plugins-row-error">{plugin.errorMessage}</span> : null}
      <PluginRowDetails plugin={plugin} />
    </div>
    <PluginRowControls plugin={plugin} />
  </div>;
}
function PluginRowDetails({ plugin }: { plugin: PluginSummary }) {
  useTranslation();
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
  return <Disclosure className="plugins-row-details" triggerClassName="plugins-row-details-toggle" ariaLabel={t("plugins.viewDetailsOf", { name: plugin.name })} title={<>
    <span>{t("plugins.details")}</span></>}>
    <div className="plugins-row-details-body">{rows.map((row) => <div key={row.key} className="plugins-row-detail">
      <span className="plugins-row-detail-label">{t(`plugins.${row.key}`)}</span>{row.content}</div>)}
      {plugin.permissions.some((key) => key.endsWith(".workspace")) ? <p className="plugins-row-detail-note">{t("plugins.legacyFsDowngraded")}</p> : null}
    </div>
  </Disclosure>;
}
