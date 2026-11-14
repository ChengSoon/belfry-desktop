import { t, useTranslation } from "../../i18n";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { usePluginRuntime } from "../../plugins/usePluginRuntime";
import type { RuntimeCatalog } from "../../plugins/runtimeContracts";
import { SButton, SList, SPage, STag } from "../../settings/kit";
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
  // 布局按 docs/design/belfry-ui/settings-v3/settings.html?page=shortcuts（T42）：
  // 说明一行 → 各分组「标题 + 列表」→ 底部「全部恢复默认」。
  return <SPage label={t("shortcuts.ShortcutSettingsSection.text_9bc299a8d5")}>
    <div className="shortcut-settings">
      <p className="sk-lede">{t("shortcuts.ShortcutSettingsSection.text_d07bd1df66")} {platform === "macos" ? t("shortcuts.ShortcutSettingsSection.text_91acc07999") : t("shortcuts.ShortcutSettingsSection.text_4c4ae4e2bc")}</p>
      {loaded.warning ? <p className="sk-note is-warn" role="alert">{loaded.warning}</p> : null}
      {runtime.error ? <p className="sk-note is-danger" role="status">{t("shortcuts.ShortcutSettingsSection.text_3add8718a5", { error: runtime.error })}</p> : null}
      {editor.message ? <p className="sk-note shortcut-settings__saved" role="status">{editor.message}</p> : null}
      {editor.edit?.kind === "defaults" ? <ShortcutResetPreview expected={editor.edit.expected} context={context} error={editor.error} onCancel={editor.cancel} onSave={editor.save} /> : null}
      <ShortcutRows context={context} overrides={overrides} editor={editor} />
      <div className="sk-foot">
        <SButton tone="secondary" id="shortcut-reset-all" disabled={Boolean(editor.edit) || Object.keys(overrides).length === 0} onClick={() => editor.begin()}>{t("shortcuts.ShortcutSettingsSection.text_3b6c48ce49")}</SButton>
      </div>
    </div>
  </SPage>;
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
    const custom = group.actions.filter((action) => Object.hasOwn(overrides, action.id)).length;
    const meta = custom
      ? t("shortcuts.ShortcutSettingsSection.groupMetaCustom", { count: group.actions.length, custom })
      : t("shortcuts.ShortcutSettingsSection.groupMeta", { count: group.actions.length });
    const toggle_ = group.collapsed ? <SButton aria-controls={`shortcut-rows-${group.id}`} aria-expanded={visible} className="shortcut-settings__toggle" disabled={locked}
      aria-label={t(visible ? "shortcuts.ShortcutSettingsSection.collapseGroup" : "shortcuts.ShortcutSettingsSection.expandGroup", { name: group.label })} onClick={() => toggle(group.id)}>
      {visible ? t("shortcuts.ShortcutSettingsSection.collapse") : t("shortcuts.ShortcutSettingsSection.expand")}
      {visible ? <ChevronDown aria-hidden="true" size={ICON.xs} /> : <ChevronRight aria-hidden="true" size={ICON.xs} />}</SButton> : null;
    return <section key={group.id} aria-labelledby={`shortcut-group-${group.id}`}>
      <div className="sk-gt-row"><h3 className="sk-gt" id={`shortcut-group-${group.id}`}>{group.label}</h3>
        <div className="sk-gt-tail"><span>{meta}</span>{toggle_}</div></div>
      <SList>
        <ul className="shortcut-settings__rows" id={`shortcut-rows-${group.id}`} hidden={!visible}>
          {visible ? group.actions.map((action) => <ShortcutRow key={action.id} action={action}
            context={context} overrides={overrides} editor={editor} keys={chords.get(action.id) ?? []} />) : null}
        </ul>
        {!visible ? <button className="sk-item is-link shortcut-settings__collapsed" aria-controls={`shortcut-rows-${group.id}`} aria-expanded={false} disabled={locked}
          onClick={() => toggle(group.id)} type="button"><span className="sk-l"><span>{t("shortcuts.ShortcutSettingsSection.collapsedHint", { count: group.actions.length })}</span></span>
          <ChevronRight aria-hidden="true" size={ICON.sm} /></button> : null}
      </SList>
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
  // 行：名称（自定义 / 已停用标记）… 键帽 + 更改；录制态整行 accent-soft，冲突就地提示。
  return <li className={`sk-item shortcut-row${recording ? " is-accent is-recording" : ""}`}>
    <div className="sk-l">
      <b>{action.label}{state.tone ? <STag tone="accent">{state.text}</STag> : keys.length === 0 ? <STag>{state.text}</STag> : null}</b>
      {issues.length ? <span className="shortcut-settings__error">{issues.join("; ")}</span> : null}
    </div>
    {draft
      ? <ShortcutEditor draft={draft} context={context} overrides={overrides} error={editor.error} onChange={editor.change} onCancel={editor.cancel} onSave={editor.save} />
      : <div className="sk-r shortcut-settings__keys">
        {keys.length ? keys.map((binding, index) => <ShortcutKeys key={index} chord={bindingChord(binding, context.platform)} />)
          : <span className="shortcut-settings__unset">{bindingChord(null, context.platform).join("+")}</span>}
        <SButton id={`shortcut-edit-${action.id}`} aria-label={t("shortcuts.ShortcutSettingsSection.text_1a458cb92b", { label: action.label })} disabled={Boolean(editor.edit)} onClick={() => editor.begin(action.id)}>{t("shortcuts.ShortcutSettingsSection.text_6b01fce4db")}</SButton>
      </div>}
  </li>;
}

function pluginBindings(runtime: RuntimeCatalog) {
  return (runtime.shortcuts ?? []).map((shortcut) => {
    const command = runtime.commands.find((item) => item.pluginId === shortcut.pluginId && item.id === shortcut.commandId);
    return { binding: shortcut.binding, label: command ? `${command.pluginName} · ${command.title}` : shortcut.pluginId };
  });
}
