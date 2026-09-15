import type { LoadedShortcuts, ShortcutSettings } from "./contracts";
import { SHORTCUT_ACTIONS } from "./actions";
import { bindingProblem } from "./chord";
import type { ShortcutPlatform } from "../resolveShortcut";

export const SHORTCUTS_KEY = "belfry.shortcuts.v1";
export const SHORTCUTS_CHANGED = "belfry:shortcuts-changed";
export const emptyShortcutSettings = (): ShortcutSettings => ({ version: 1, macos: {}, control: {} });

const MAX_STORAGE_BYTES = 64 * 1024;

export function loadShortcutSettings(storage?: Pick<Storage, "getItem">): LoadedShortcuts {
  try { return parseShortcuts((storage ?? globalThis.localStorage)?.getItem(SHORTCUTS_KEY) ?? null); }
  catch { return { settings: emptyShortcutSettings(), warning: "快捷键存档无法读取，当前使用默认值" }; }
}

export function saveShortcutSettings(settings: ShortcutSettings, storage?: Pick<Storage, "setItem">) {
  const destination = storage ?? globalThis.localStorage;
  if (!destination) throw new Error("当前环境无法保存快捷键");
  destination.setItem(SHORTCUTS_KEY, JSON.stringify(settings));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHORTCUTS_CHANGED));
}

function parseShortcuts(raw: string | null): LoadedShortcuts {
  const settings = emptyShortcutSettings();
  if (!raw) return { settings, warning: null };
  if (raw.length > MAX_STORAGE_BYTES) return { settings, warning: "快捷键存档过大，当前使用默认值" };
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) return { settings, warning: "快捷键存档版本无法识别，当前使用默认值" };
  const invalid = parsePlatform(value, settings, "macos") + parsePlatform(value, settings, "control");
  return { settings, warning: invalid ? `发现 ${invalid} 处无效配置；无效键位已停用，无法读取的平台使用默认值，请检查后重新设置` : null };
}

function parsePlatform(value: Record<string, unknown>, settings: ShortcutSettings, platform: ShortcutPlatform) {
  const overrides = value[platform];
  if (overrides === undefined) return 0;
  if (!record(overrides)) return 1;
  let invalid = 0;
  for (const { id } of SHORTCUT_ACTIONS) {
    if (!Object.hasOwn(overrides, id)) continue;
    const binding = overrides[id];
    if (binding === null) { settings[platform][id] = null; continue; }
    const valid = record(binding) && typeof binding.code === "string" && typeof binding.shift === "boolean";
    if (!valid || bindingProblem({ code: binding.code as string, shift: binding.shift as boolean }, platform)) {
      settings[platform][id] = null; invalid += 1;
    } else settings[platform][id] = { code: binding.code as string, shift: binding.shift as boolean };
  }
  return invalid;
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }

export function subscribeShortcutSettings(notify: () => void) {
  const changed = (event: StorageEvent) => {
    if (event.key === null || event.key === SHORTCUTS_KEY) notify();
  };
  window.addEventListener(SHORTCUTS_CHANGED, notify);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(SHORTCUTS_CHANGED, notify);
    window.removeEventListener("storage", changed);
  };
}
