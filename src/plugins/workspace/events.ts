export const VIEW_EVENT = "plugin-view-open-local";
export const DOCK_EVENT = "plugin-dock-toggle";
export const LAUNCHER_EVENT = "plugin-launcher-toggle";
export interface ViewRequest { pluginId: string; viewId: string }
export const viewKey = (pluginId: string, viewId: string) => `${pluginId}:${viewId}`;
export function revealPluginView(pluginId: string, viewId: string) {
  window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: { pluginId, viewId } }));
}
export function togglePluginDock() { window.dispatchEvent(new Event(DOCK_EVENT)); }
export function togglePluginLauncher() { window.dispatchEvent(new Event(LAUNCHER_EVENT)); }
