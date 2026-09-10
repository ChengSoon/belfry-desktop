import { resolveAppShortcut } from "../../shortcuts/resolveShortcut";

type KeyEvent = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;
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
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key;
  const value = [event.metaKey ? "Meta" : "", event.ctrlKey ? "Ctrl" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", key].filter(Boolean).join("+");
  return normalizeShortcut(value, mac);
}
export function shortcutMatches(binding: string, event: KeyEvent, mac: boolean) {
  return !!binding && normalizeShortcut(binding, mac) === shortcutFromEvent(event, mac);
}
export function shortcutConflict(bindings: string[], mac: boolean) {
  const seen = new Set<string>();
  for (const raw of bindings.filter(Boolean)) {
    const normalized = normalizeShortcut(raw, mac), parts = normalized.split("+"), key = parts.at(-1)!;
    if (!normalized || parts.length < 2 || seen.has(normalized)) return true;
    const code = keyCode(key);
    const event = { code, ctrlKey: parts.includes("ctrl"), metaKey: parts.includes("meta"), altKey: parts.includes("alt"), shiftKey: parts.includes("shift"), isComposing: false, repeat: false };
    if (resolveAppShortcut(event, mac ? "macos" : "control")) return true;
    if (systemShortcut(parts, key)) return true;
    seen.add(normalized);
  }
  return false;
}
function keyCode(key: string) {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  return key === "," ? "Comma" : key === "/" ? "Slash" : key;
}
function systemShortcut(parts: string[], key: string) {
  return (parts.includes("meta") || parts.includes("ctrl")) && !parts.includes("shift") && !parts.includes("alt")
    && ["q", "w", "r", "l", "c", "v", "x", "a", "z"].includes(key);
}
export function shortcutLabel(value: string, mac: boolean) {
  return normalizeShortcut(value, mac).split("+").map((part) => ({ meta: "⌘", ctrl: "Ctrl", alt: "Alt", shift: "Shift" })[part] ?? part.toUpperCase()).join("+") || "—";
}
