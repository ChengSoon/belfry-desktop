import { localized, t } from "../../i18n";
import type { AppShortcut, ShortcutPlatform } from "../resolveShortcut";
import type { ActionId, SimpleActionId, ShortcutBinding } from "./contracts";

export interface ShortcutAction { id: ActionId; label: string; code: string; shiftOnMac?: boolean }
const SESSION_COUNT = 9;

export const SHORTCUT_ACTIONS: ShortcutAction[] = localized(() => ([
  { id: "new-shell", label: t("shortcuts.actions.text_5f38508162"), code: "KeyT" },
  { id: "toggle-sidebar", label: t("shortcuts.actions.text_ab942bb0e5"), code: "KeyB" },
  { id: "toggle-usage", label: t("shortcuts.actions.text_cad4ebfe80"), code: "KeyU" },
  { id: "toggle-history", label: t("shortcuts.actions.text_7388d51b1d"), code: "KeyH", shiftOnMac: true },
  { id: "open-settings", label: t("shortcuts.actions.text_37aa6ad6a3"), code: "Comma" },
  { id: "toggle-quick-open", label: t("shortcuts.actions.text_9bde3a4112"), code: "KeyK" },
  { id: "toggle-shortcuts", label: t("shortcuts.actions.text_2b604575fb"), code: "Slash" },
  ...Array.from({ length: SESSION_COUNT }, (_, index): ShortcutAction => ({
    id: `activate-session-${index + 1}` as ActionId, label: t("shortcuts.actions.text_5d5ecdbc68", { index: index + 1 }), code: `Digit${index + 1}`,
  })),
]));

export function defaultBinding(action: ShortcutAction, platform: ShortcutPlatform): ShortcutBinding {
  return { code: action.code, shift: platform === "control" || Boolean(action.shiftOnMac) };
}

export function shortcutForAction(id: ActionId): AppShortcut {
  if (id.startsWith("activate-session-")) return { kind: "activate-session", index: Number(id.at(-1)) - 1 };
  return { kind: id as SimpleActionId };
}
