// Adapted from PI-Desktop PluginViewTab / work panel, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PanelRightClose, Plug, RefreshCw } from "lucide-react";
import { usePluginRuntime } from "../usePluginRuntime";
import { useViewSurfaces } from "./useViewSurfaces";
import { useViewDrops } from "./useViewDrops";
import { VIEW_EVENT, viewKey, type ViewRequest } from "./events";
import "./workspace.css";

export function PluginDock({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const runtime = usePluginRuntime();
  const container = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState("");
  const views = [...runtime.views].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  return <aside ref={container} className="plugin-dock" hidden={!visible} aria-label="插件工作面板">
    <header className="plugin-dock-header"><Plug size={15} />
      <select aria-label="选择插件视图" value={active ? viewKey(active.pluginId, active.id) : ""} onChange={(event) => setSelected(event.target.value)}>
        {!views.length ? <option value="">插件工作面板</option> : views.map((view) => <option key={viewKey(view.pluginId, view.id)} value={viewKey(view.pluginId, view.id)}>
          {typeof view.title === "string" ? view.title : view.title["zh-CN"] ?? view.title.en ?? view.id}</option>)}
      </select>
      <button className="icon-button icon-button--sm" type="button" aria-label="刷新插件视图" disabled={!active} onClick={refresh}><RefreshCw size={14} /></button>
      <button className="icon-button icon-button--sm" type="button" aria-label="关闭工作面板" onClick={onClose}><PanelRightClose size={16} /></button>
    </header>
    {error ? <p className="plugin-dock-message" role="alert">{error}</p> : null}
    {!active ? <div className="plugin-dock-empty"><Plug size={24} /><p>没有可用的插件视图</p><span>在插件页面安装并启用提供工作区视图的插件。</span></div> : null}
    {surfaces.map((surface) => <iframe key={`${surface.key}:${surface.pid}:${surface.revision}`} title={surface.title} src={surface.url}
      className="plugin-dock-frame" hidden={!visible || surface.key !== key} sandbox="allow-scripts allow-same-origin allow-forms" referrerPolicy="no-referrer" />)}
  </aside>;
}
