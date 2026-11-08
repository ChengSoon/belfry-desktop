import { t, useTranslation } from "../../i18n";
// Adapted from PI-Desktop PluginViewTab / work panel, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PanelRightClose, Plug, RefreshCw } from "lucide-react";
import { Dropdown } from "../center/ui";
import { usePluginRuntime } from "../usePluginRuntime";
import { useViewSurfaces } from "./useViewSurfaces";
import { useViewDrops } from "./useViewDrops";
import { VIEW_EVENT, viewKey, type ViewRequest } from "./events";
import { localizedText } from "../runtimeCatalog";
import "../center/styles/index.css";
import "./workspace.css";

export function PluginDock({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useTranslation();
  const runtime = usePluginRuntime();
  const container = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState("");
  const views = [...runtime.views].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const options = views.map((view) => ({ value: viewKey(view.pluginId, view.id),
    label: localizedText(view.title, view.id) }));
  const active = views.find((view) => viewKey(view.pluginId, view.id) === selected) ?? views[0];
  const { surfaces, key, error, refresh } = useViewSurfaces(visible ? active : undefined, runtime);
  useViewDrops(container, visible ? active : undefined);
  useEffect(() => {
    const select = (value: ViewRequest) => setSelected(viewKey(value.pluginId, value.viewId));
    const local = (event: Event) => select((event as CustomEvent<ViewRequest>).detail);
    window.addEventListener(VIEW_EVENT, local);
    const stop = listen<ViewRequest>("plugin-view-open", ({ payload }) => select(payload)).catch(() => () => {});
    return () => { window.removeEventListener(VIEW_EVENT, local); void stop.then((unlisten) => unlisten()); };
  }, []);
  return <aside ref={container} className="plugin-dock" hidden={!visible} aria-label={t("plugins.PluginDock.text_75288484d2")}>
    <header className="plugin-dock-header"><Plug size={15} />
      <div className="pi-plugins plugin-dock-view-picker">
        <Dropdown ariaLabel={t("plugins.PluginDock.text_53593b0107")} value={active ? viewKey(active.pluginId, active.id) : ""} onChange={setSelected}
          options={options.length ? options : [{ value: "", label: t("plugins.PluginDock.text_75288484d2") }]} disabled={!visible} />
      </div>
      <button className="icon-button icon-button--sm" type="button" aria-label={t("plugins.PluginDock.text_09b84ef415")} disabled={!active} onClick={refresh}><RefreshCw size={14} /></button>
      <button className="icon-button icon-button--sm" type="button" aria-label={t("plugins.PluginDock.text_96434dc4ac")} onClick={onClose}><PanelRightClose size={16} /></button>
    </header>
    {active ? <div className="plugin-dock-context"><span>{t("plugins.PluginDock.text_93f875e384")}</span><code title={active.pluginId}>{active.pluginId}</code></div> : null}
    {error ? <div className="plugin-dock-message" role="alert"><span>{error}</span><button type="button" onClick={refresh}>{t("plugins.PluginDock.text_d6754f8b01")}</button></div> : null}
    {!active ? <div className="plugin-dock-empty"><Plug size={24} /><p>{t("plugins.PluginDock.text_a93c0f32e3")}</p><span>{t("plugins.PluginDock.text_3427ce55ce")}</span></div> : null}
    {surfaces.map((surface) => <iframe key={`${surface.key}:${surface.pid}:${surface.revision}`} title={localizedText(views.find((view) => viewKey(view.pluginId, view.id) === surface.key)?.title, surface.title)} src={surface.url}
      className="plugin-dock-frame" hidden={!visible || surface.key !== key} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />)}
  </aside>;
}
