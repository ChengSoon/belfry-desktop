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
      {!plugin.ui?.panel && view ? <button type="button" className="plugins-icon-btn" aria-label="打开工作区视图" title="打开工作区视图"
        disabled={actions.busy || !plugin.enabled} onClick={() => revealPluginView(plugin.id, view.id)}><IconPanel size={15} /></button> : null}
      {plugin.enabled && plugin.settings?.length ? <button type="button" className="plugins-icon-btn" aria-label={t("plugins.openSettings")}
        title={t("plugins.openSettings")} disabled={actions.busy} onClick={() => void settings()}><IconSettings size={15} /></button> : null}
      <RowMenu plugin={plugin} />
    </div>
  </div>;
}
function RowMenu({ plugin }: { plugin: PluginSummary }) {
  const { actions, setPublishDirectory } = usePluginsPage(), menu = usePopover();
  const run = (operation: () => Promise<unknown>) => { menu.setOpen(false); void actions.run(operation); };
  return <div className="plugins-menu-wrap" ref={menu.ref}>
    <button type="button" className="plugins-icon-btn" aria-label={t("plugins.rowActions", { name: plugin.name })}
      title={t("plugins.rowActions", { name: plugin.name })} aria-haspopup="menu" aria-expanded={menu.open} disabled={actions.busy} onClick={() => menu.setOpen(!menu.open)}><IconMore size={15} /></button>
    {menu.open ? <div className={cx("plugins-menu is-end", menu.up && "is-up")} role="menu">
      {plugin.source === "dev" ? <>
        <button type="button" role="menuitem" onClick={() => run(() => actions.mutate(plugin.id, "reload"))}><IconReview size={14} />{t("plugins.reload")}</button>
        <button type="button" role="menuitem" onClick={() => run(async () => { const result = await pluginHost.check(plugin.path!); pluginNotice(`校验通过：${result.fileCount} 个文件${result.warnings.length ? `；${result.warnings.join("；")}` : ""}`); })}><IconPackageCheck size={14} />校验插件</button>
        <button type="button" role="menuitem" onClick={() => run(() => packPlugin(plugin))}><IconPackage size={14} />导出插件包</button>
        <button type="button" role="menuitem" onClick={() => { menu.setOpen(false); if (plugin.path) setPublishDirectory(plugin.path); }}><IconCloudDown size={14} />发布到我的市场</button>
      </> : null}
      <button type="button" role="menuitem" onClick={() => run(() => centerApi.setPreference(plugin.id, { autoUpdate: !plugin.autoUpdate }))}>
        <IconCloudDown size={14} />{t(plugin.autoUpdate ? "plugins.disableAutoUpdate" : "plugins.enableAutoUpdate")}</button>
      <div className="plugins-menu-sep" />
      <button type="button" role="menuitem" className="danger" onClick={() => run(() => actions.mutate(plugin.id, "uninstall"))}><IconTrash size={14} />{t("plugins.uninstall")}</button>
    </div> : null}
  </div>;
}
async function packPlugin(plugin: PluginSummary) {
  const output = await open({ directory: true, multiple: false, title: "选择插件包输出目录" });
  if (typeof output !== "string" || !plugin.path) return;
  const result = await pluginHost.pack(plugin.path, output);
  pluginNotice(`已导出 ${result.fileName}`);
  await centerApi.reveal(result.packagePath);
}
