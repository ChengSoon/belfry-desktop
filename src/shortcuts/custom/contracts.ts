import type { AppShortcut, ShortcutPlatform } from "../resolveShortcut";

type SessionNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type SimpleActionId = Exclude<AppShortcut["kind"], "activate-session">;
export type ActionId = SimpleActionId | `activate-session-${SessionNumber}`;
export interface ShortcutBinding { code: string; shift: boolean }
export type ShortcutOverrides = Partial<Record<ActionId, ShortcutBinding | null>>;
export interface ShortcutSettings { version: 1; macos: ShortcutOverrides; control: ShortcutOverrides }
export interface LoadedShortcuts { settings: ShortcutSettings; warning: string | null }
export interface PluginBinding { binding: string; label: string }
export interface BindingChange {
  action: ActionId;
  binding: ShortcutBinding | null | undefined;
  platform: ShortcutPlatform;
  overrides: ShortcutOverrides;
  plugins?: PluginBinding[];
}
export type KeyInput = Pick<KeyboardEvent, "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "isComposing">
  & { key?: string; keyCode?: number };
