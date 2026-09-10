// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import { Button } from "./ui";
import { IconCloudDown, IconDownload, IconMore, IconPlug } from "./icons";
import { t } from "./i18n";
import { usePopover } from "./usePopover";
import { centerApi } from "./api";
import { inspectLocal } from "./useCenterActions";
import { pluginNotice } from "../PluginRuntimeBridge";
import { choosePublication, exportOwnMarket } from "./PersonalMarketControls";

export function PageHeader() {
  const { tab, setTab, market, actions, data } = usePluginsPage();
  const updates = data.plugins.filter((plugin) => plugin.updateAvailable).length;
  return <>
    <div className="page-header plugins-page-header">
      <div className="plugins-title-block"><span className="plugins-title-icon" aria-hidden><IconPlug size={14} /></span>
        <div className="plugins-title-copy"><h1 className="page-title">{t("plugins.title")}</h1></div></div>
      <div className="plugins-header-actions">
        {tab === "market" ? <Button variant="primary" size="sm" disabled={market.loading} onClick={() => void market.refresh(true)}>
          <IconCloudDown size={14} />{t("plugins.refreshMarket")}</Button> :
          <Button variant="primary" size="sm" onClick={() => setTab("market")}><IconDownload size={14} />{t("plugins.browseMarket")}</Button>}
        <HeaderMenu />
      </div>
    </div>
    {updates > 0 ? <div className="plugins-alert" role="status">
      <span className="plugins-alert-icon" aria-hidden><IconCloudDown size={15} /></span>
      <div className="plugins-alert-copy"><span className="plugins-alert-title">{t("plugins.updatesReady", { count: updates })}</span></div>
      <Button variant="secondary" size="sm" disabled={actions.busy} onClick={() => void actions.run(applyUpdates)}>{t("plugins.applyAutoUpdates")}</Button>
    </div> : null}
  </>;
}
export async function applyUpdates() {
  const result = await centerApi.applyUpdates();
  pluginNotice(t("plugins.autoUpdatesApplied", { count: result.results.length }) + (result.skipped.length ? `；${result.skipped.length} 个更新需要手动确认权限` : ""));
}
function HeaderMenu() {
  const { actions, setTemplate, setPublishDirectory } = usePluginsPage();
  const menu = usePopover();
  const entries = [
    { key: "checkUpdates", run: () => actions.run(async () => { const result = await centerApi.checkUpdates(); pluginNotice(t("plugins.updatesFound", { count: result.updates.length })); }) },
    { key: "applyAutoUpdates", run: () => actions.run(applyUpdates) },
    { key: "installPackage", run: () => inspectLocal(actions, false) },
    { key: "loadDev", run: () => inspectLocal(actions, true) },
    { key: "newFromTemplate", run: () => setTemplate("panel-basic") },
    { key: "publishOwnPlugin", label: "发布到我的市场", run: () => choosePublication(actions, setPublishDirectory) },
    { key: "exportOwnMarket", label: "导出我的市场网站", run: () => exportOwnMarket(actions) },
  ];
  return <div className="plugins-menu-wrap" ref={menu.ref}>
    <button type="button" className="plugins-icon-btn plugins-header-menu" aria-label={t("plugins.moreActions")}
      title={t("plugins.moreActions")} aria-haspopup="menu" aria-expanded={menu.open} disabled={actions.busy} onClick={() => menu.setOpen(!menu.open)}><IconMore size={16} /></button>
    {menu.open ? <div className="plugins-menu is-end" role="menu">{entries.map((entry) =>
      <button key={entry.key} type="button" role="menuitem" onClick={() => { menu.setOpen(false); void entry.run(); }}>{entry.label ?? t(`plugins.${entry.key}`)}</button>)}
    </div> : null}
  </div>;
}
