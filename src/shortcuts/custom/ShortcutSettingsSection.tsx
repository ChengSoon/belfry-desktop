import { Notice } from "../../components/Notice";
import { t, useTranslation } from "../../i18n";
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
import { ShortcutKeys } from "./ShortcutKeys";
import { ShortcutResetPreview } from "./ShortcutResetPreview";
import { useShortcutEditor } from "./useShortcutEditor";
import { useShortcutSettings } from "./useShortcutSettings";
import type { EditContext } from "./changes";
import type { ShortcutAction } from "./actions";
import type { ShortcutBinding, ShortcutOverrides } from "./contracts";
import "../../settings/obsidianSections.css";
import "./shortcutSettings.css";

export function ShortcutSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  useTranslation();
  const loaded = useShortcutSettings(), runtime = usePluginRuntime();
  const platform = shortcutPlatform(typeof document === "undefined" ? undefined : document.documentElement.dataset.platform);
  const context = { platform, plugins: pluginBindings(runtime) };
  const overrides = loaded.settings[platform], editor = useShortcutEditor(context, overrides);
  useEffect(() => {
    onGuardChange(Boolean(editor.edit));
    return () => onGuardChange(false);
  }, [Boolean(editor.edit), onGuardChange]);
  return <section className="shortcut-settings os-page" aria-label={t("shortcuts.ShortcutSettingsSection.text_9bc299a8d5")}>
    <SettingsHeader
      actions={<button className="os-btn secondary" id="shortcut-reset-all" type="button" disabled={Boolean(editor.edit) || Object.keys(overrides).length === 0} onClick={() => editor.begin()}>{t("shortcuts.ShortcutSettingsSection.text_3b6c48ce49")}</button>}
      description={t("shortcuts.ShortcutSettingsSection.text_d07bd1df66")}
      title={t("shortcuts.ShortcutSettingsSection.text_ee2638183d")}
    />
    <Notice className="shortcut-settings__scope" tone="info">
      <strong>{platform === "macos" ? t("shortcuts.ShortcutSettingsSection.text_91acc07999") : t("shortcuts.ShortcutSettingsSection.text_4c4ae4e2bc")}</strong>
      {t("shortcuts.ShortcutSettingsSection.text_60f7e4945e")}
    </Notice>
    {loaded.warning ? <Notice className="shortcut-settings__error" tone="warning" role="alert">{loaded.warning}</Notice> : null}
    {runtime.error ? <Notice className="shortcut-settings__error" role="status">{t("shortcuts.ShortcutSettingsSection.text_3add8718a5", { error: runtime.error })}</Notice> : null}
    {editor.message ? <p className="shortcut-settings__saved" role="status">{editor.message}</p> : null}
    {editor.edit?.kind === "defaults" ? <ShortcutResetPreview expected={editor.edit.expected} context={context} error={editor.error} onCancel={editor.cancel} onSave={editor.save} /> : null}
    <ShortcutRows context={context} overrides={overrides} editor={editor} />
  </section>;
}

interface RowsProps {
  context: EditContext; overrides: ShortcutOverrides; editor: ReturnType<typeof useShortcutEditor>;
  expanded?: readonly string[];
}

/** 按用途分组；序号键位默认收起，编辑中的组始终保持展开。 */
export function ShortcutRows({ context, overrides, editor, expanded }: RowsProps) {
  useTranslation();
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

  return <>{groups.map((group) => {
    const visible = shown(group);
    const locked = group.actions.some((action) => action.id === editing);
    const toggleProps = {
      "aria-expanded": visible,
      "aria-controls": `shortcut-rows-${group.id}`,
      "aria-label": t(visible ? "shortcuts.ShortcutSettingsSection.collapseGroup" : "shortcuts.ShortcutSettingsSection.expandGroup", { name: group.label }),
      disabled: locked,
      onClick: () => toggle(group.id),
      type: "button" as const,
    };
    const count = <span>{t(visible ? "shortcuts.ShortcutSettingsSection.collapseCount" : "shortcuts.ShortcutSettingsSection.expandCount", { count: group.actions.length })}
      {visible ? <ChevronDown aria-hidden="true" size={ICON.xs} /> : <ChevronRight aria-hidden="true" size={ICON.xs} />}</span>;
    return <section className="os-section" key={group.id} aria-labelledby={`shortcut-group-${group.id}`}>
      {visible ? <div className="os-group-head">
        <h3 id={`shortcut-group-${group.id}`}>{group.label}</h3>
        {group.collapsed ? <button className="shortcut-settings__toggle" {...toggleProps}>{count}</button> : null}
      </div> : null}
      <div className="os-group">
        {/* 折叠组整组收成一行：名称 +「9 项 · 展开」（T19 稿）。 */}
        {!visible ? <button className="shortcut-settings__collapsed" {...toggleProps}>
          <span id={`shortcut-group-${group.id}`}>{group.label}</span>{count}
        </button> : null}
        <ul className="shortcut-settings__rows" id={`shortcut-rows-${group.id}`} hidden={!visible}>
          {visible ? group.actions.map((action) => <ShortcutRow key={action.id} action={action}
            context={context} overrides={overrides} editor={editor} keys={chords.get(action.id) ?? []} />) : null}
        </ul>
      </div>
    </section>;
  })}</>;
}

function ShortcutRow({ action, keys, context, overrides, editor }: RowsProps & { action: ShortcutAction; keys: ShortcutBinding[] }) {
  useTranslation();
  const issues = bindingIssues({ ...context, action: action.id, binding: overrides[action.id], overrides });
  const draft = editor.edit?.kind === "binding" && editor.edit.draft.action === action.id ? editor.edit.draft : null;
  const recording = draft !== null;
  const state = keys.length === 0 ? { tone: "", text: t("shortcuts.ShortcutSettingsSection.text_a8c3698b5b") }
    : Object.hasOwn(overrides, action.id) ? { tone: " accent", text: t("shortcuts.ShortcutSettingsSection.text_4eafa9e925") }
      : { tone: "", text: t("shortcuts.ShortcutSettingsSection.text_844b8cc8df") };
  return <li className={`os-row shortcut-row${recording ? " is-recording" : ""}`}>
    <div className="os-row__body">
      <div className="os-row__label"><span>{action.label}</span><span className={`os-tag${state.tone}`}>{state.text}</span></div>
      {issues.length ? <p className="shortcut-settings__error">{issues.join("; ")}</p> : null}
    </div>
    {recording ? null : <div className="os-trail shortcut-settings__keys">
      {keys.length ? keys.map((binding, index) => <ShortcutKeys key={index} chord={bindingChord(binding, context.platform)} />)
        : <span className="shortcut-settings__unset">{bindingChord(null, context.platform).join("+")}</span>}
      <button className="os-btn" id={`shortcut-edit-${action.id}`} type="button" aria-label={t("shortcuts.ShortcutSettingsSection.text_1a458cb92b", { label: action.label })} disabled={Boolean(editor.edit)} onClick={() => editor.begin(action.id)}>{t("shortcuts.ShortcutSettingsSection.text_6b01fce4db")}</button>
    </div>}
    {draft
      ? <ShortcutEditor draft={draft} context={context} overrides={overrides} error={editor.error} onChange={editor.change} onCancel={editor.cancel} onSave={editor.save} /> : null}
  </li>;
}

function pluginBindings(runtime: RuntimeCatalog) {
  return (runtime.shortcuts ?? []).map((shortcut) => {
    const command = runtime.commands.find((item) => item.pluginId === shortcut.pluginId && item.id === shortcut.commandId);
    return { binding: shortcut.binding, label: command ? `${command.pluginName} · ${command.title}` : shortcut.pluginId };
  });
}
