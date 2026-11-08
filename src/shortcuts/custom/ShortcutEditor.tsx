import { useFeedback, t, useTranslation } from "../../i18n";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SHORTCUT_ACTIONS, defaultBinding } from "./actions";
import { bindingIssues, recordBinding } from "./bindings";
import { bindingChord } from "./chord";
import { composingKey } from "../../utils/keyboard";
import type { BindingDraft, EditContext } from "./changes";
import type { ShortcutBinding, ShortcutOverrides } from "./contracts";

interface Props {
  draft: BindingDraft; context: EditContext; overrides: ShortcutOverrides; error: string | null;
  onChange: (binding: ShortcutBinding | null | undefined) => void;
  onCancel: () => void; onSave: () => void;
}

export function ShortcutEditor(props: Props) {
  useTranslation();
  const [recording, setRecording] = useState(true);
  const [keyError, setKeyError] = useFeedback<string | null>(null);
  const recorder = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (recording) recorder.current?.focus(); }, [recording]);
  const issues = bindingIssues({ ...props.context, ...props.draft, overrides: props.overrides });
  const error = keyError ?? props.error ?? issues[0];
  const action = SHORTCUT_ACTIONS.find((item) => item.id === props.draft.action)!;
  const preview = props.draft.binding === undefined ? defaultBinding(action, props.context.platform) : props.draft.binding;
  const change = (binding: BindingDraft["binding"]) => { setKeyError(null); setRecording(false); props.onChange(binding); };
  const press = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.key === "Tab" || composingKey(event.nativeEvent)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { props.onCancel(); return; }
    const result = recordBinding(event.nativeEvent, props.context.platform);
    if (result.binding) change(result.binding);
    setKeyError(() => result.error);
  };
  return <div className="shortcut-editor" aria-label={t("shortcuts.ShortcutEditor.text_f18f9adcac", { label: action.label })}>
    <button type="button" className="shortcut-editor__recorder" ref={recorder} data-shortcut-recorder={recording}
      aria-describedby="shortcut-recorder-help" onKeyDown={press} onBlur={() => setRecording(false)} onClick={() => setRecording(true)}>
      {recording ? t("shortcuts.ShortcutEditor.text_9f74096a45") : t("shortcuts.ShortcutEditor.text_e869e08188")}
    </button>
    <p id="shortcut-recorder-help">{t(props.context.platform === "macos" ? "shortcuts.ShortcutEditor.recordMac" : "shortcuts.ShortcutEditor.recordControl")}</p>
    <p className="shortcut-editor__preview">{t(props.draft.binding === undefined ? "shortcuts.ShortcutEditor.defaultPreview" : "shortcuts.ShortcutEditor.preview", { shortcut: bindingChord(preview, props.context.platform).join("+") })}</p>
    {error ? <p className="shortcut-settings__error" role="alert">{error}</p> : null}
    <footer>
      <button type="button" onClick={() => change(null)}>{t("shortcuts.ShortcutEditor.text_4e6fd0e28c")}</button>
      <button type="button" onClick={() => change(undefined)}>{t("shortcuts.ShortcutEditor.text_7bdeee3d3f")}</button>
      <span className="shortcut-editor__spacer" />
      <button type="button" onClick={props.onCancel}>{t("shortcuts.ShortcutEditor.text_2cd0f3be87")}</button>
      <button type="button" className="shortcut-settings__primary" disabled={recording || Boolean(error)} onClick={props.onSave}>{t("shortcuts.ShortcutEditor.text_a3030bf8f1")}</button>
    </footer>
  </div>;
}
