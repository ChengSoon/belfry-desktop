import { useEffect } from "react";
import { usePluginRuntime } from "../../plugins/usePluginRuntime";
import type { RuntimeCatalog } from "../../plugins/runtimeContracts";
import { shortcutPlatform } from "../resolveShortcut";
import { bindingIssues, effectiveBindings } from "./bindings";
import { bindingChord } from "./chord";
import { ShortcutEditor } from "./ShortcutEditor";
import { ShortcutResetPreview } from "./ShortcutResetPreview";
import { useShortcutEditor } from "./useShortcutEditor";
import { useShortcutSettings } from "./useShortcutSettings";
import type { EditContext } from "./changes";
import type { ShortcutOverrides } from "./contracts";
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
    <header><div><h2>快捷键</h2><p>将常用操作放在顺手的位置。录制后预览，保存即生效。</p></div>
      <button id="shortcut-reset-all" type="button" disabled={Boolean(editor.edit) || Object.keys(overrides).length === 0} onClick={() => editor.begin()}>全部恢复默认</button></header>
    <p className="shortcut-settings__scope">{platform === "macos" ? "当前平台：macOS · ⌘ / ⌘+Shift" : "当前平台：Windows / Linux · Ctrl+Shift"}</p>
    {loaded.warning ? <p className="shortcut-settings__error" role="alert">{loaded.warning}</p> : null}
    {runtime.error ? <p className="shortcut-settings__error" role="status">插件快捷键暂时无法读取：{runtime.error}</p> : null}
    {editor.message ? <p className="shortcut-settings__saved" role="status">{editor.message}</p> : null}
    {editor.edit?.kind === "defaults" ? <ShortcutResetPreview expected={editor.edit.expected} context={context} error={editor.error} onCancel={editor.cancel} onSave={editor.save} /> : null}
    <ShortcutRows context={context} overrides={overrides} editor={editor} />
    <p>终端编辑、查找、刷新及系统窗口组合键会保留。已启用插件的快捷键也会参与冲突检查。</p>
  </section>;
}

export function ShortcutRows({ context, overrides, editor }: {
  context: EditContext; overrides: ShortcutOverrides; editor: ReturnType<typeof useShortcutEditor>;
}) {
  return <ul className="shortcut-settings__rows">{effectiveBindings(context.platform, overrides).map(({ action, bindings }) => {
    const issues = bindingIssues({ ...context, action: action.id, binding: overrides[action.id], overrides });
    return <li key={action.id} className="shortcut-settings__row">
      <div className="shortcut-settings__action"><span>{action.label}</span>
        <small>{bindings.length === 0 ? "已停用" : Object.hasOwn(overrides, action.id) ? "自定义" : "默认"}</small>
        {issues.length ? <small className="shortcut-settings__error">{issues.join("；")}</small> : null}</div>
      <div className="shortcut-settings__keys">
        {(bindings.length ? bindings : [null]).map((binding, index) => <kbd key={index}>{bindingChord(binding, context.platform).join("+")}</kbd>)}
        <button id={`shortcut-edit-${action.id}`} type="button" aria-label={`修改${action.label}快捷键`} disabled={Boolean(editor.edit)} onClick={() => editor.begin(action.id)}>更改</button>
      </div>
      {editor.edit?.kind === "binding" && editor.edit.draft.action === action.id
        ? <ShortcutEditor draft={editor.edit.draft} context={context} overrides={overrides} error={editor.error} onChange={editor.change} onCancel={editor.cancel} onSave={editor.save} /> : null}
    </li>;
  })}</ul>;
}

function pluginBindings(runtime: RuntimeCatalog) {
  return (runtime.shortcuts ?? []).map((shortcut) => {
    const command = runtime.commands.find((item) => item.pluginId === shortcut.pluginId && item.id === shortcut.commandId);
    return { binding: shortcut.binding, label: command ? `${command.pluginName} · ${command.title}` : shortcut.pluginId };
  });
}
