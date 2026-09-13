import type { ShortcutPlatform } from "../resolveShortcut";
import { SHORTCUT_ACTIONS } from "./actions";
import { applyBindingChange, bindingIssues } from "./bindings";
import type { ActionId, PluginBinding, ShortcutBinding, ShortcutOverrides } from "./contracts";
import { loadShortcutSettings, saveShortcutSettings } from "./storage";

export interface BindingDraft {
  action: ActionId;
  binding: ShortcutBinding | null | undefined;
  original: ShortcutBinding | null | undefined;
}
export interface EditContext { platform: ShortcutPlatform; plugins: PluginBinding[] }
type ShortcutStorage = Pick<Storage, "getItem" | "setItem">;

export function saveBindingDraft(draft: BindingDraft, context: EditContext, storage?: ShortcutStorage) {
  const { settings } = loadShortcutSettings(storage);
  if (!sameBinding(settings[context.platform][draft.action], draft.original)) {
    throw new Error("此动作已在其他窗口修改，请取消后重新编辑");
  }
  const next = applyBindingChange(settings, { ...context, action: draft.action, binding: draft.binding });
  saveShortcutSettings(next, storage);
}

export function defaultBindingIssues(context: EditContext) {
  return SHORTCUT_ACTIONS.flatMap((action) => bindingIssues({
    ...context, action: action.id, binding: undefined, overrides: {},
  }).map((issue) => `${action.label}：${issue}`));
}

export function saveDefaultBindings(expected: ShortcutOverrides, context: EditContext, storage?: ShortcutStorage) {
  const { settings } = loadShortcutSettings(storage);
  if (SHORTCUT_ACTIONS.some(({ id }) => !sameBinding(expected[id], settings[context.platform][id]))) {
    throw new Error("快捷键在预览后已发生变化，请取消后重新预览");
  }
  const issues = defaultBindingIssues(context);
  if (issues.length) throw new Error(issues.join("；"));
  saveShortcutSettings({ ...settings, [context.platform]: {} }, storage);
}

function sameBinding(left: BindingDraft["binding"], right: BindingDraft["binding"]) {
  if (!left || !right) return left === right;
  return left.code === right.code && left.shift === right.shift;
}
