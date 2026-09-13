import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { SHORTCUT_ACTIONS, defaultBinding } from "./actions";
import { bindingIssues, recordBinding } from "./bindings";
import { bindingChord } from "./chord";
import type { BindingDraft, EditContext } from "./changes";
import type { ShortcutBinding, ShortcutOverrides } from "./contracts";

interface Props {
  draft: BindingDraft; context: EditContext; overrides: ShortcutOverrides; error: string | null;
  onChange: (binding: ShortcutBinding | null | undefined) => void;
  onCancel: () => void; onSave: () => void;
}

export function ShortcutEditor(props: Props) {
  const [recording, setRecording] = useState(true);
  const [keyError, setKeyError] = useState<string | null>(null);
  const recorder = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (recording) recorder.current?.focus(); }, [recording]);
  const issues = bindingIssues({ ...props.context, ...props.draft, overrides: props.overrides });
  const error = keyError ?? props.error ?? issues[0];
  const action = SHORTCUT_ACTIONS.find((item) => item.id === props.draft.action)!;
  const preview = props.draft.binding === undefined ? defaultBinding(action, props.context.platform) : props.draft.binding;
  const change = (binding: BindingDraft["binding"]) => { setKeyError(null); setRecording(false); props.onChange(binding); };
  const press = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.key === "Tab") return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === "Escape") { props.onCancel(); return; }
    const result = recordBinding(event.nativeEvent, props.context.platform);
    if (result.binding) change(result.binding);
    setKeyError(result.error);
  };
  return <div className="shortcut-editor" aria-label={`编辑${action.label}`}>
    <button type="button" className="shortcut-editor__recorder" ref={recorder} data-shortcut-recorder={recording}
      aria-describedby="shortcut-recorder-help" onKeyDown={press} onBlur={() => setRecording(false)} onClick={() => setRecording(true)}>
      {recording ? "请按下新的组合键…" : "重新录制"}
    </button>
    <p id="shortcut-recorder-help">{props.context.platform === "macos" ? "使用 ⌘，可搭配 Shift" : "使用 Ctrl+Shift"} · Esc 取消录制，Tab 离开</p>
    <p className="shortcut-editor__preview">保存后：<strong>{bindingChord(preview, props.context.platform).join("+")}</strong>
      {props.draft.binding === undefined ? "（默认）" : null}</p>
    {error ? <p className="shortcut-settings__error" role="alert">{error}</p> : null}
    <footer>
      <button type="button" onClick={() => change(null)}>停用</button>
      <button type="button" onClick={() => change(undefined)}>恢复此项默认</button>
      <span className="shortcut-editor__spacer" />
      <button type="button" onClick={props.onCancel}>取消</button>
      <button type="button" className="shortcut-settings__primary" disabled={recording || Boolean(error)} onClick={props.onSave}>保存</button>
    </footer>
  </div>;
}
