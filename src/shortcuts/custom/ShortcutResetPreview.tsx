import { defaultBinding } from "./actions";
import { effectiveBindings } from "./bindings";
import { bindingChord } from "./chord";
import { defaultBindingIssues, type EditContext } from "./changes";
import type { ShortcutOverrides } from "./contracts";

export function ShortcutResetPreview(props: {
  expected: ShortcutOverrides; context: EditContext; error: string | null;
  onCancel: () => void; onSave: () => void;
}) {
  const items = effectiveBindings(props.context.platform, props.expected).filter(({ action }) => Object.hasOwn(props.expected, action.id));
  const issues = defaultBindingIssues(props.context);
  return <section className="shortcut-reset" aria-label="恢复默认预览">
    <h3>将恢复 {items.length} 项快捷键</h3>
    <ul>{items.map(({ action, bindings }) => <li key={action.id}>
      <span>{action.label}</span>
      <span>{bindingChord(bindings[0], props.context.platform).join("+")} → {bindingChord(defaultBinding(action, props.context.platform), props.context.platform).join("+")}</span>
    </li>)}</ul>
    {props.error ? <p className="shortcut-settings__error" role="alert">{props.error}</p> : null}
    {issues.length ? <p className="shortcut-settings__error" role="alert">{issues.join("；")}</p> : null}
    <footer><button type="button" onClick={props.onCancel}>取消</button>
      <button type="button" className="shortcut-settings__primary" disabled={issues.length > 0} onClick={props.onSave}>确认恢复默认</button></footer>
  </section>;
}
