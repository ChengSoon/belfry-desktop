import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePluginRuntime } from "../../plugins/usePluginRuntime";
import type { RuntimeCatalog } from "../../plugins/runtimeContracts";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { ICON } from "../../theme/sizing";
import { shortcutPlatform } from "../resolveShortcut";
import { bindingIssues, effectiveBindings } from "./bindings";
import { bindingChord } from "./chord";
import { groupShortcutActions, type ShortcutGroup } from "./groups";
import { ShortcutEditor } from "./ShortcutEditor";
import { ShortcutResetPreview } from "./ShortcutResetPreview";
import { useShortcutEditor } from "./useShortcutEditor";
import { useShortcutSettings } from "./useShortcutSettings";
import type { EditContext } from "./changes";
import type { ShortcutAction } from "./actions";
import type { ShortcutBinding, ShortcutOverrides } from "./contracts";
import "./shortcutSettings.css";

export function ShortcutSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  const loaded = useShortcutSettings(), runtime = usePluginRuntime();
  const platform = shortcutPlatform(typeof document === "undefined" ? undefined : document.documentElement.dataset.platform);
  const context = { platform, plugins: pluginBindings(runtime) };
  const overrides = loaded.settings[platform], editor = useShortcutEditor(context, overrides);
  useEffect(() => {
    onGuardChange(Boolean(editor.edit));
    return () => onGuardChange(false);
  }, [Boolean(editor.edit), onGuardChange]);
  return <section className="shortcut-settings" aria-label="快捷键设置">
    <SettingsHeader
      actions={<button id="shortcut-reset-all" type="button" disabled={Boolean(editor.edit) || Object.keys(overrides).length === 0} onClick={() => editor.begin()}>全部恢复默认</button>}
      description="将常用操作放在顺手的位置。录制后预览，保存即生效。"
      title="快捷键"
    />
    <p className="shortcut-settings__scope">{platform === "macos" ? "当前平台：macOS · ⌘ / ⌘+Shift" : "当前平台：Windows / Linux · Ctrl+Shift"}</p>
    {loaded.warning ? <p className="shortcut-settings__error" role="alert">{loaded.warning}</p> : null}
    {runtime.error ? <p className="shortcut-settings__error" role="status">插件快捷键暂时无法读取：{runtime.error}</p> : null}
    {editor.message ? <p className="shortcut-settings__saved" role="status">{editor.message}</p> : null}
    {editor.edit?.kind === "defaults" ? <ShortcutResetPreview expected={editor.edit.expected} context={context} error={editor.error} onCancel={editor.cancel} onSave={editor.save} /> : null}
    <ShortcutRows context={context} overrides={overrides} editor={editor} />
    <p>终端编辑、查找、刷新及系统窗口组合键会保留。已启用插件的快捷键也会参与冲突检查。</p>
  </section>;
}

interface RowsProps {
  context: EditContext; overrides: ShortcutOverrides; editor: ReturnType<typeof useShortcutEditor>;
  expanded?: readonly string[];
}

/** 按用途分组；序号键位默认收起，编辑中的组始终保持展开。 */
export function ShortcutRows({ context, overrides, editor, expanded }: RowsProps) {
  const [open, setOpen] = useState<readonly string[]>(() => expanded ?? []);
  const bindings = effectiveBindings(context.platform, overrides);
  const chords = new Map(bindings.map(({ action, bindings: keys }) => [action.id, keys]));
  const groups = groupShortcutActions(bindings.map(({ action }) => action));

  const editing = editor.edit?.kind === "binding" ? editor.edit.draft.action : null;
  const shown = (group: ShortcutGroup) => !group.collapsed
    || open.includes(group.id)
    || (editing !== null && group.actions.some((action) => action.id === editing));

  const toggle = (id: string) => setOpen((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  return <>{groups.map((group) => <section className="settings-group" key={group.id} aria-labelledby={`shortcut-group-${group.id}`}>
    <div className="settings-group__label">
      <h3 id={`shortcut-group-${group.id}`}>{group.label}</h3>
      {group.collapsed ? <button
        aria-expanded={shown(group)}
        aria-controls={`shortcut-rows-${group.id}`}
        aria-label={`${shown(group) ? "收起" : "展开"}${group.label}快捷键`}
        className="shortcut-settings__toggle"
        disabled={group.actions.some((action) => action.id === editing)}
        onClick={() => toggle(group.id)}
        type="button"
      >
        {shown(group) ? <ChevronDown aria-hidden="true" size={ICON.xs} /> : <ChevronRight aria-hidden="true" size={ICON.xs} />}
        <span>{group.actions.length} 项 · {shown(group) ? "收起" : "展开"}</span>
      </button> : null}
    </div>
    <ul className="settings-card shortcut-settings__rows" id={`shortcut-rows-${group.id}`} hidden={!shown(group)}>
      {shown(group) ? group.actions.map((action) => <ShortcutRow key={action.id} action={action}
        context={context} overrides={overrides} editor={editor} keys={chords.get(action.id) ?? []} />) : null}
    </ul>
  </section>)}</>;
}

function ShortcutRow({ action, keys, context, overrides, editor }: RowsProps & { action: ShortcutAction; keys: ShortcutBinding[] }) {
  const issues = bindingIssues({ ...context, action: action.id, binding: overrides[action.id], overrides });
  return <li className="settings-row">
    <div className="settings-row__label">
      <span>{action.label}</span>
      <small>{keys.length === 0 ? "已停用" : Object.hasOwn(overrides, action.id) ? "自定义" : "默认"}</small>
      {issues.length ? <small className="shortcut-settings__error">{issues.join("；")}</small> : null}
    </div>
    <div className="settings-row__control shortcut-settings__keys">
      {(keys.length ? keys : [null]).map((binding, index) => <kbd key={index}>{bindingChord(binding, context.platform).join("+")}</kbd>)}
      <button id={`shortcut-edit-${action.id}`} type="button" aria-label={`修改${action.label}快捷键`} disabled={Boolean(editor.edit)} onClick={() => editor.begin(action.id)}>更改</button>
    </div>
    {editor.edit?.kind === "binding" && editor.edit.draft.action === action.id
      ? <ShortcutEditor draft={editor.edit.draft} context={context} overrides={overrides} error={editor.error} onChange={editor.change} onCancel={editor.cancel} onSave={editor.save} /> : null}
  </li>;
}

function pluginBindings(runtime: RuntimeCatalog) {
  return (runtime.shortcuts ?? []).map((shortcut) => {
    const command = runtime.commands.find((item) => item.pluginId === shortcut.pluginId && item.id === shortcut.commandId);
    return { binding: shortcut.binding, label: command ? `${command.pluginName} · ${command.title}` : shortcut.pluginId };
  });
}
