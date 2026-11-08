import { t } from "../../i18n";
import type { ShortcutPlatform } from "../resolveShortcut";
import { SHORTCUT_ACTIONS, defaultBinding } from "./actions";
import type { BindingChange, KeyInput, ShortcutOverrides, ShortcutSettings } from "./contracts";
import { bindingKey, bindingProblem, composingInput, hasHostModifiers, keyLabel } from "./chord";
import { shortcutMatches } from "../chords";

export function effectiveBindings(platform: ShortcutPlatform, overrides: ShortcutOverrides) {
  return SHORTCUT_ACTIONS.map((action) => {
    const override = overrides[action.id];
    const binding = override === undefined ? defaultBinding(action, platform) : override;
    const bindings = binding && !bindingProblem(binding, platform) ? [binding] : [];
    if (platform === "macos" && action.id === "toggle-shortcuts" && override === undefined) bindings.push({ code: "Slash", shift: true });
    return { action, bindings };
  });
}

export function bindingIssues(change: BindingChange): string[] {
  if (change.binding) {
    const problem = bindingProblem(change.binding, change.platform);
    if (problem) return [problem];
  }
  const overrides = changedOverrides(change);
  const items = effectiveBindings(change.platform, overrides);
  const target = items.find((item) => item.action.id === change.action)!;
  const keys = new Set(target.bindings.map(bindingKey));
  const conflicts = items.filter((item) => item.action.id !== change.action && item.bindings.some((binding) => keys.has(bindingKey(binding))));
  const issues = conflicts.map((item) => t("shortcuts.bindings.text_758e435970", { label: item.action.label }));
  for (const plugin of change.plugins ?? []) {
    if (target.bindings.some((binding) => shortcutMatches(plugin.binding, {
      code: binding.code, key: keyLabel(binding.code), shiftKey: binding.shift, altKey: false,
      metaKey: change.platform === "macos", ctrlKey: change.platform === "control",
    }, change.platform === "macos"))) issues.push(t("shortcuts.bindings.text_2b708aa8d3", { label: plugin.label }));
  }
  return issues;
}

export function changedOverrides(change: BindingChange): ShortcutOverrides {
  const overrides = { ...change.overrides };
  if (change.binding === undefined) delete overrides[change.action];
  else overrides[change.action] = change.binding;
  return overrides;
}

export function applyBindingChange(settings: ShortcutSettings, change: Omit<BindingChange, "overrides">): ShortcutSettings {
  const proposal = { ...change, overrides: settings[change.platform] };
  const issues = bindingIssues(proposal);
  if (issues.length) throw new Error(issues.join("; "));
  return { ...settings, [change.platform]: changedOverrides(proposal) };
}

export function recordBinding(event: KeyInput, platform: ShortcutPlatform) {
  if (composingInput(event) || event.repeat || /^(Meta|Control|Alt|Shift)(Left|Right)$/.test(event.code)) return { binding: null, error: null };
  if (!hasHostModifiers(event, platform)) return { binding: null, error: platform === "macos" ? t("shortcuts.bindings.text_ff521b171a") : t("shortcuts.bindings.text_d21c175fee") };
  const binding = { code: event.code, shift: event.shiftKey };
  return { binding, error: bindingProblem(binding, platform) };
}
