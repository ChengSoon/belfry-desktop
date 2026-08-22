export type ShortcutPlatform = "macos" | "control";

export type AppShortcut =
  | { kind: "toggle-sidebar" }
  | { kind: "toggle-usage" }
  | { kind: "toggle-history" }
  | { kind: "toggle-shortcuts" }
  | { kind: "toggle-quick-open" }
  | { kind: "toggle-composer" }
  | { kind: "toggle-recipes" }
  | { kind: "toggle-context" }
  | { kind: "toggle-collab" }
  | { kind: "open-settings" }
  | { kind: "new-shell" }
  | { kind: "activate-session"; index: number };

type ShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "code" | "ctrlKey" | "isComposing" | "metaKey" | "repeat" | "shiftKey"
>;

/** Belfry 在 Windows/Linux 统一加 Shift，避免抢走 Agent TUI 的 Ctrl 组合键。 */
export function resolveAppShortcut(
  event: ShortcutEvent,
  platform: ShortcutPlatform,
): AppShortcut | null {
  if (event.isComposing || event.repeat || event.altKey) return null;
  if (!hasAppModifiers(event, platform)) return null;

  const code = event.code;
  if (platform === "macos" && event.shiftKey && code !== "KeyH" && code !== "Slash") return null;
  if (platform === "macos" && !event.shiftKey && code === "KeyH") return null;
  if (code === "KeyB") return { kind: "toggle-sidebar" };
  if (code === "KeyU") return { kind: "toggle-usage" };
  if (code === "KeyH") return { kind: "toggle-history" };
  if (code === "Slash") return { kind: "toggle-shortcuts" };
  if (code === "KeyK") return { kind: "toggle-quick-open" };
  if (code === "KeyJ") return { kind: "toggle-composer" };
  // Windows 的 Ctrl+Shift+R 与 macOS 的 ⌘R 本来是 WebView 的刷新键，capture 阶段
  // preventDefault 掉——重载会连同所有 PTY 一起丢，代价比抢走一个组合键大得多。
  if (code === "KeyR") return { kind: "toggle-recipes" };
  if (code === "KeyG") return { kind: "toggle-context" };
  // 不用 KeyA：⌘A 是全选，终端里是刚需，抢掉代价太大。
  if (code === "KeyY") return { kind: "toggle-collab" };
  if (code === "Comma") return { kind: "open-settings" };
  if (code === "KeyT") return { kind: "new-shell" };
  if (/^Digit[1-9]$/.test(code)) return { kind: "activate-session", index: Number(code.at(-1)) - 1 };
  return null;
}

export function shortcutPlatform(platform: string | undefined): ShortcutPlatform {
  return platform === "macos" ? "macos" : "control";
}

export function appShortcutChord(
  platform: ShortcutPlatform,
  key: string,
  shiftOnMac = false,
) {
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
