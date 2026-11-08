import { t } from "../../i18n";
import type { ShortcutPlatform } from "../resolveShortcut";
import type { KeyInput, ShortcutBinding } from "./contracts";
import { composingKey } from "../../utils/keyboard";

const KEY_LABELS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`" };
const TERMINAL_KEYS = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyF", "KeyR"]);
const WINDOW_KEYS = new Set(["KeyQ", "KeyW", "KeyM"]);

export function keyLabel(code: string) { return KEY_LABELS[code] ?? code.replace(/^(Key|Digit)/, ""); }
export function bindingKey(binding: ShortcutBinding) { return `${binding.shift ? "shift+" : ""}${binding.code}`; }
export function composingInput(event: KeyInput) { return composingKey(event); }
export function hasHostModifiers(event: KeyInput, platform: ShortcutPlatform) {
  if (event.altKey) return false;
  return platform === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}

export function bindingProblem(binding: ShortcutBinding, platform: ShortcutPlatform): string | null {
  if (!/^Key[A-Z]$|^Digit[0-9]$/.test(binding.code) && !Object.hasOwn(KEY_LABELS, binding.code)) return t("shortcuts.chord.text_85c3f38590");
  if (platform === "control" && !binding.shift) return t("shortcuts.chord.text_a57ab4b87d");
  if (TERMINAL_KEYS.has(binding.code)) return t("shortcuts.chord.text_64edfd613c");
  if (WINDOW_KEYS.has(binding.code)) return t("shortcuts.chord.text_606af63ed8");
  if (platform === "macos" && ((binding.code === "KeyH" && !binding.shift)
    || (binding.shift && /^Digit[345]$/.test(binding.code)))) return t("shortcuts.chord.text_be0ff4323b");
  return null;
}

export function bindingChord(binding: ShortcutBinding | null | undefined, platform: ShortcutPlatform): string[] {
  if (!binding) return [t("shortcuts.chord.text_52496e5aef")];
  const modifiers = platform === "macos" ? ["⌘"] : ["Ctrl"];
  if (binding.shift) modifiers.push("Shift");
  return [...modifiers, keyLabel(binding.code)];
}

export function codeForLabel(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return Object.entries(KEY_LABELS).find(([, label]) => label === key)?.[0] ?? key;
}
