import { resolveAppShortcut, shouldPreventWebviewReload } from "../../shortcuts/resolveShortcut";
import { normalizeShortcut } from "../../shortcuts/chords";
import { codeForLabel } from "../../shortcuts/custom/chord";
export { isMac, normalizeShortcut, shortcutFromEvent, shortcutMatches, shortcutLabel } from "../../shortcuts/chords";
export function shortcutConflict(bindings: string[], mac: boolean) {
  const seen = new Set<string>();
  for (const raw of bindings.filter(Boolean)) {
    const normalized = normalizeShortcut(raw, mac), parts = normalized.split("+"), key = parts.at(-1)!;
    if (!normalized || parts.length < 2 || seen.has(normalized)) return true;
    const code = codeForLabel(key);
    const event = { code, ctrlKey: parts.includes("ctrl"), metaKey: parts.includes("meta"), altKey: parts.includes("alt"), shiftKey: parts.includes("shift"), isComposing: false, repeat: false };
    const platform = mac ? "macos" : "control";
    if (resolveAppShortcut(event, platform) || shouldPreventWebviewReload(event, platform)) return true;
    if (systemShortcut(parts, key)) return true;
    seen.add(normalized);
  }
  return false;
}
function systemShortcut(parts: string[], key: string) {
  return (parts.includes("meta") || parts.includes("ctrl")) && !parts.includes("shift") && !parts.includes("alt")
    && ["q", "w", "r", "l", "c", "v", "x", "a", "z"].includes(key);
}
