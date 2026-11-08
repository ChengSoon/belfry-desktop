import { useTranslation } from "../../i18n";
// Adapted from PI-Desktop PluginsPage.tsx, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { usePluginsPage } from "./context";
import type { PluginSummary } from "./types";
import { ScopeControl } from "./ScopeControl";
import { Button, cx } from "./ui";
import { IconCloudDown, IconMore, IconPackage, IconPackageCheck, IconPanel, IconReview, IconSettings, IconTrash } from "./icons";
import { t } from "./i18n";
import { usePopover } from "./usePopover";
import { pluginHost } from "../useDirectoryRegistry";
import { centerApi } from "./api";
import { pluginNotice } from "../PluginRuntimeBridge";
import { open } from "@tauri-apps/plugin-dialog";
import { revealPluginView } from "../workspace/events";

export function PluginRowControls({ plugin }: { plugin: PluginSummary }) {
  useTranslation();
  const { actions, setSettingsPlugin, data } = usePluginsPage();
  const view = data.runtime.views.find((item) => item.pluginId === plugin.id);
  const update = plugin.updateAvailable;
  const settings = () => actions.run(async () => {
    const values = await pluginHost.getSettings(plugin.id);
    setSettingsPlugin({ ...plugin, settings: plugin.settings?.map((item) => ({ ...item, value: values[item.key] })) });
  });
  return <div className="plugins-row-controls">
    {update ? <Button size="sm" disabled={actions.busy} onClick={() => actions.queueInstall({ id: plugin.id, name: plugin.name,
      version: update.version, permissions: [...plugin.permissions, ...(update.permissionDiff ?? [])], newPermissions: update.permissionDiff })}>{t("plugins.updateNow")}</Button> : null}
    <ScopeControl plugin={plugin} />
    <div className="plugins-row-actions">
      {plugin.ui?.panel ? <button type="button" className="plugins-icon-btn" aria-label={t("plugins.openPanel")} title={t("plugins.openPanel")}
        disabled={actions.busy || !plugin.enabled} onClick={() => void actions.run(() => pluginHost.openPanel(plugin.id))}><IconPanel size={15} /></button> : null}
      {!plugin.ui?.panel && view ? <button type="button" className="plugins-icon-btn" aria-label={t("plugins.PluginRowControls.text_2b8f1b1bd4")} title={t("plugins.PluginRowControls.text_2b8f1b1bd4")}
        disabled={actions.busy || !plugin.enabled} onClick={() => revealPluginView(plugin.id, view.id)}><IconPanel size={15} /></button> : null}
      {plugin.enabled && plugin.settings?.length ? <button type="button" className="plugins-icon-btn" aria-label={t("plugins.openSettings")}
        title={t("plugins.openSettings")} disabled={actions.busy} onClick={() => void settings()}><IconSettings size={15} /></button> : null}
      <RowMenu plugin={plugin} />
    </div>
  </div>;
}
function RowMenu({ plugin }: { plugin: PluginSummary }) {
  useTranslation();
  const { actions, setPublishDirectory } = usePluginsPage(), menu = usePopover();
  const run = (operation: () => Promise<unknown>) => { menu.setOpen(false); void actions.run(operation); };
  return <div className="plugins-menu-wrap" ref={menu.ref}>
    <button type="button" className="plugins-icon-btn" aria-label={t("plugins.rowActions", { name: plugin.name })}
      title={t("plugins.rowActions", { name: plugin.name })} aria-haspopup="menu" aria-expanded={menu.open} disabled={actions.busy} onClick={() => menu.setOpen(!menu.open)}><IconMore size={15} /></button>
    {menu.open ? <div className={cx("plugins-menu is-end", menu.up && "is-up")} role="menu">
      {plugin.source === "dev" ? <>
        <button type="button" role="menuitem" onClick={() => run(() => actions.mutate(plugin.id, "reload"))}><IconReview size={14} />{t("plugins.reload")}</button>
        <button type="button" role="menuitem" onClick={() => run(async () => { const result = await pluginHost.check(plugin.path!); pluginNotice([t("plugins.PluginRowControls.validationPassed", { count: result.fileCount }), ...result.warnings].join("\n")); })}><IconPackageCheck size={14} />{t("plugins.PluginRowControls.text_dcfe107665")}</button>
        <button type="button" role="menuitem" onClick={() => run(() => packPlugin(plugin))}><IconPackage size={14} />{t("plugins.PluginRowControls.text_649256d26f")}</button>
        <button type="button" role="menuitem" onClick={() => { menu.setOpen(false); if (plugin.path) setPublishDirectory(plugin.path); }}><IconCloudDown size={14} />{t("plugins.PluginRowControls.text_b6f61fa3f1")}</button>
      </> : null}
      <button type="button" role="menuitem" onClick={() => run(() => centerApi.setPreference(plugin.id, { autoUpdate: !plugin.autoUpdate }))}>
        <IconCloudDown size={14} />{t(plugin.autoUpdate ? "plugins.disableAutoUpdate" : "plugins.enableAutoUpdate")}</button>
      <div className="plugins-menu-sep" />
      <button type="button" role="menuitem" className="danger" onClick={() => run(() => actions.mutate(plugin.id, "uninstall"))}><IconTrash size={14} />{t("plugins.uninstall")}</button>
    </div> : null}
  </div>;
}
async function packPlugin(plugin: PluginSummary) {
  const output = await open({ directory: true, multiple: false, title: t("plugins.PluginRowControls.text_1188173abd") });
  if (typeof output !== "string" || !plugin.path) return;
  const result = await pluginHost.pack(plugin.path, output);
  pluginNotice(t("plugins.PluginRowControls.text_4f9d0d263c", { fileName: result.fileName }));
  await centerApi.reveal(result.packagePath);
}
