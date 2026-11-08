import { TranslationError, t } from "../../i18n";
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
  catch { return { settings: emptyShortcutSettings(), warning: t("shortcuts.storage.text_10176a9211") }; }
}

export function saveShortcutSettings(settings: ShortcutSettings, storage?: Pick<Storage, "setItem">) {
  const destination = storage ?? globalThis.localStorage;
  if (!destination) throw new TranslationError("shortcuts.storage.text_3c15c5ee25");
  destination.setItem(SHORTCUTS_KEY, JSON.stringify(settings));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SHORTCUTS_CHANGED));
}

function parseShortcuts(raw: string | null): LoadedShortcuts {
  const settings = emptyShortcutSettings();
  if (!raw) return { settings, warning: null };
  if (raw.length > MAX_STORAGE_BYTES) return { settings, warning: t("shortcuts.storage.text_eb9c1a9cf0") };
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1) return { settings, warning: t("shortcuts.storage.text_3c7f365cbc") };
  const invalid = parsePlatform(value, settings, "macos") + parsePlatform(value, settings, "control");
  return { settings, warning: invalid ? t("shortcuts.storage.text_47eeb29a32", { invalid: invalid }) : null };
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
