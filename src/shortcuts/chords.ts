import { keyLabel } from "./custom/chord";

const SHIFTED_KEYS: Record<string, string> = {
  "?": "/", ">": ".", "<": ",", ":": ";", '"': "'", "{": "[", "}": "]", "|": "\\", "_": "-", "~": "`",
};

export type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
export function isMac() { return /mac/i.test(navigator.platform); }
export function normalizeShortcut(value: string, mac: boolean): string {
  const keys = value.split("+").map((key) => key.trim().toLowerCase()).filter(Boolean);
  const modifiers = new Set<string>();
  let main = "";
  for (const key of keys) {
    const modifier = modifierKey(key, mac);
    if (modifier) { modifiers.add(modifier); continue; }
    if (main) return "";
    main = key;
  }
  if (SHIFTED_KEYS[main]) { main = SHIFTED_KEYS[main]; modifiers.add("shift"); }
  return main ? [...["meta", "ctrl", "alt", "shift"].filter((key) => modifiers.has(key)), main].join("+") : "";
}

function modifierKey(key: string, mac: boolean) {
  if (["mod", "cmdorctrl", "commandorcontrol"].includes(key)) return mac ? "meta" : "ctrl";
  if (["cmd", "command", "meta", "super"].includes(key)) return "meta";
  if (["ctrl", "control"].includes(key)) return "ctrl";
  if (["alt", "option"].includes(key)) return "alt";
  return key === "shift" ? "shift" : undefined;
}

export function shortcutFromEvent(event: KeyEvent, mac: boolean) {
  if (["Meta", "Control", "Alt", "Shift"].includes(event.key)) return "";
  const physical = keyLabel(event.code);
  const key = physical === event.code ? event.key : physical;
  const value = [event.metaKey ? "Meta" : "", event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
  return normalizeShortcut(value, mac);
}

export function shortcutMatches(binding: string, event: KeyEvent, mac: boolean) {
  return !!binding && normalizeShortcut(binding, mac) === shortcutFromEvent(event, mac);
}

export function shortcutLabel(value: string, mac: boolean) {
  return normalizeShortcut(value, mac).split("+").map((part) => ({ meta: "⌘", ctrl: "Ctrl", alt: "Alt", shift: "Shift" })[part] ?? part.toUpperCase()).join("+") || "—";
}
