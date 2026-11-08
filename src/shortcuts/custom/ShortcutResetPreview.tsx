import { t, useTranslation } from "../../i18n";
import { defaultBinding } from "./actions";
import { effectiveBindings } from "./bindings";
import { bindingChord } from "./chord";
import { defaultBindingIssues, type EditContext } from "./changes";
import type { ShortcutOverrides } from "./contracts";

export function ShortcutResetPreview(props: {
  expected: ShortcutOverrides; context: EditContext; error: string | null;
  onCancel: () => void; onSave: () => void;
}) {
  useTranslation();
  const items = effectiveBindings(props.context.platform, props.expected).filter(({ action }) => Object.hasOwn(props.expected, action.id));
  const issues = defaultBindingIssues(props.context);
  return <section className="shortcut-reset" aria-label={t("shortcuts.ShortcutResetPreview.text_186ee6aba7")}>
    <h3>{t("shortcuts.ShortcutResetPreview.text_0fd33165f3", { count: items.length })}</h3>
    <ul>{items.map(({ action, bindings }) => <li key={action.id}>
      <span>{action.label}</span>
      <span>{bindingChord(bindings[0], props.context.platform).join("+")} → {bindingChord(defaultBinding(action, props.context.platform), props.context.platform).join("+")}</span>
    </li>)}</ul>
    {props.error ? <p className="shortcut-settings__error" role="alert">{props.error}</p> : null}
    {issues.length ? <p className="shortcut-settings__error" role="alert">{issues.join("; ")}</p> : null}
    <footer><button type="button" onClick={props.onCancel}>{t("shortcuts.ShortcutResetPreview.text_2cd0f3be87")}</button>
      <button type="button" className="shortcut-settings__primary" disabled={issues.length > 0} onClick={props.onSave}>{t("shortcuts.ShortcutResetPreview.text_9f4bd186f9")}</button></footer>
  </section>;
}
