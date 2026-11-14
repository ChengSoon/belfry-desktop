import { useSyncExternalStore } from "react";

/** 界面偏好（T41）：减少动效、紧凑侧栏。存在 localStorage，生效方式是给 <html> 打 data 属性，
    具体样式由 CSS 按属性响应，不在组件里分支。 */
export interface InterfacePreferences { reduceMotion: boolean; compactSidebar: boolean }
export const INTERFACE_KEY = "belfry.interface.v1";
export const DEFAULT_INTERFACE: InterfacePreferences = { reduceMotion: false, compactSidebar: false };

export function parseInterface(value: string | null): InterfacePreferences {
  try {
    const raw: unknown = value ? JSON.parse(value) : null;
    if (!raw || typeof raw !== "object") return DEFAULT_INTERFACE;
    const record = raw as Record<string, unknown>;
    return { reduceMotion: record.reduceMotion === true, compactSidebar: record.compactSidebar === true };
  } catch { return DEFAULT_INTERFACE; }
}

export function applyInterface(prefs: InterfacePreferences, root: { dataset: DOMStringMap } = document.documentElement) {
  if (prefs.reduceMotion) root.dataset.motion = "reduced"; else delete root.dataset.motion;
  if (prefs.compactSidebar) root.dataset.sidebarDensity = "compact"; else delete root.dataset.sidebarDensity;
}

let current: InterfacePreferences | null = null;
const listeners = new Set<() => void>();
function read() {
  if (!current) {
    try { current = parseInterface(localStorage.getItem(INTERFACE_KEY)); } catch { current = DEFAULT_INTERFACE; }
  }
  return current;
}
export function setInterface(patch: Partial<InterfacePreferences>) {
  current = { ...read(), ...patch };
  try { localStorage.setItem(INTERFACE_KEY, JSON.stringify(current)); } catch { /* 存不下也照样生效到本次会话 */ }
  applyInterface(current);
  listeners.forEach((listener) => listener());
}
export function initInterface() { applyInterface(read()); }
export function useInterface() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, read, read);
}
