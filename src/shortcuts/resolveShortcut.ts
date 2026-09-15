import { effectiveBindings } from "./custom/bindings";
import { SHORTCUT_ACTIONS, shortcutForAction } from "./custom/actions";
import { bindingChord, composingInput, codeForLabel, hasHostModifiers } from "./custom/chord";
import { loadShortcutSettings } from "./custom/storage";
import type { KeyInput, ShortcutOverrides } from "./custom/contracts";

export type ShortcutPlatform = "macos" | "control";

export type AppShortcut =
  | { kind: "toggle-sidebar" }
  | { kind: "toggle-usage" }
  | { kind: "toggle-history" }
  | { kind: "toggle-shortcuts" }
  | { kind: "toggle-quick-open" }
  | { kind: "open-settings" }
  | { kind: "new-shell" }
  | { kind: "activate-session"; index: number };

type ShortcutEvent = KeyInput;

/** Belfry 在 Windows/Linux 统一加 Shift，避免抢走 Agent TUI 的 Ctrl 组合键。 */
export function resolveAppShortcut(
  event: ShortcutEvent,
  platform: ShortcutPlatform,
  overrides?: ShortcutOverrides,
): AppShortcut | null {
  if (composingInput(event) || event.repeat || !hasHostModifiers(event, platform)) return null;
  const bindings = effectiveBindings(platform, overrides ?? loadShortcutSettings().settings[platform]);
  const matches = bindings.filter((item) => item.bindings.some((binding) => binding.code === event.code && binding.shift === event.shiftKey));
  return matches.length === 1 ? shortcutForAction(matches[0].action.id) : null;
}

// 原面板使用的刷新组合键仍需拦截，避免 WebView 重载导致终端会话丢失。
export function shouldPreventWebviewReload(event: ShortcutEvent, platform: ShortcutPlatform) {
  return event.code === "KeyR" && !event.altKey && !composingInput(event)
    && hasAppModifiers(event, platform);
}

export function shortcutPlatform(platform: string | undefined): ShortcutPlatform {
  return platform === "macos" ? "macos" : "control";
}

export function appShortcutChord(
  platform: ShortcutPlatform,
  key: string,
  shiftOnMac = false,
) {
  const action = SHORTCUT_ACTIONS.find((action) => action.code === codeForLabel(key));
  if (action) {
    const configured = effectiveBindings(platform, loadShortcutSettings().settings[platform]).find((item) => item.action.id === action.id);
    return bindingChord(configured?.bindings[0], platform);
  }
  const modifiers = platform === "macos" ? ["⌘"] : ["Ctrl", "Shift"];
  if (platform === "macos" && shiftOnMac) modifiers.push("Shift");
  return [...modifiers, key];
}

export function systemShortcutChord(platform: ShortcutPlatform, key: string) {
  return [platform === "macos" ? "⌘" : "Ctrl", key];
}

export function formatShortcutChord(keys: string[]) {
  return keys.join("+");
}

function hasAppModifiers(event: ShortcutEvent, platform: ShortcutPlatform) {
  if (platform === "macos") return event.metaKey && !event.ctrlKey;
  return event.ctrlKey && event.shiftKey && !event.metaKey;
}
