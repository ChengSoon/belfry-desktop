import type { ShortcutPlatform } from "../resolveShortcut";
import type { KeyInput, ShortcutBinding } from "./contracts";

const KEY_LABELS: Record<string, string> = { Comma: ",", Period: ".", Slash: "/", Semicolon: ";", Quote: "'",
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Minus: "-", Equal: "=", Backquote: "`" };
const TERMINAL_KEYS = new Set(["KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyF", "KeyR"]);
const WINDOW_KEYS = new Set(["KeyQ", "KeyW", "KeyM"]);

export function keyLabel(code: string) { return KEY_LABELS[code] ?? code.replace(/^(Key|Digit)/, ""); }
export function bindingKey(binding: ShortcutBinding) { return `${binding.shift ? "shift+" : ""}${binding.code}`; }
export function composingInput(event: KeyInput) { return event.isComposing || event.keyCode === 229 || event.key === "Process"; }
export function hasHostModifiers(event: KeyInput, platform: ShortcutPlatform) {
  if (event.altKey) return false;
  return platform === "macos" ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey;
}

export function bindingProblem(binding: ShortcutBinding, platform: ShortcutPlatform): string | null {
  if (!/^Key[A-Z]$|^Digit[0-9]$/.test(binding.code) && !Object.hasOwn(KEY_LABELS, binding.code)) return "请使用字母、数字或标点键";
  if (platform === "control" && !binding.shift) return "Windows / Linux 使用 Ctrl+Shift，保留 CLI 原生 Ctrl 快捷键";
  if (TERMINAL_KEYS.has(binding.code)) return "此组合键保留给终端编辑、查找或刷新保护";
  if (WINDOW_KEYS.has(binding.code)) return "此组合键保留给系统窗口操作";
  if (platform === "macos" && ((binding.code === "KeyH" && !binding.shift)
    || (binding.shift && /^Digit[345]$/.test(binding.code)))) return "此组合键保留给系统隐藏或截屏操作";
  return null;
}

export function bindingChord(binding: ShortcutBinding | null | undefined, platform: ShortcutPlatform): string[] {
  if (!binding) return ["未分配"];
  const modifiers = platform === "macos" ? ["⌘"] : ["Ctrl"];
  if (binding.shift) modifiers.push("Shift");
  return [...modifiers, keyLabel(binding.code)];
}

export function codeForLabel(key: string) {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return Object.entries(KEY_LABELS).find(([, label]) => label === key)?.[0] ?? key;
}
