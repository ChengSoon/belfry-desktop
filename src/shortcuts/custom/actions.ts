import type { AppShortcut, ShortcutPlatform } from "../resolveShortcut";
import type { ActionId, SimpleActionId, ShortcutBinding } from "./contracts";

export interface ShortcutAction { id: ActionId; label: string; code: string; shiftOnMac?: boolean }
const SESSION_COUNT = 9;

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: "new-shell", label: "新建 Shell 会话", code: "KeyT" },
  { id: "toggle-sidebar", label: "显示 / 隐藏侧栏", code: "KeyB" },
  { id: "toggle-usage", label: "打开 / 关闭用量", code: "KeyU" },
  { id: "toggle-history", label: "打开 / 关闭历史", code: "KeyH", shiftOnMac: true },
  { id: "open-settings", label: "打开设置", code: "Comma" },
  { id: "toggle-quick-open", label: "打开 Quick Open", code: "KeyK" },
  { id: "toggle-shortcuts", label: "打开快捷指令", code: "Slash" },
  ...Array.from({ length: SESSION_COUNT }, (_, index): ShortcutAction => ({
    id: `activate-session-${index + 1}` as ActionId, label: `切换第 ${index + 1} 个会话`, code: `Digit${index + 1}`,
  })),
];

export function defaultBinding(action: ShortcutAction, platform: ShortcutPlatform): ShortcutBinding {
  return { code: action.code, shift: platform === "control" || Boolean(action.shiftOnMac) };
}

export function shortcutForAction(id: ActionId): AppShortcut {
  if (id.startsWith("activate-session-")) return { kind: "activate-session", index: Number(id.at(-1)) - 1 };
  return { kind: id as SimpleActionId };
}
