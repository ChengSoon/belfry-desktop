import { useState } from "react";
import type { ActionId, ShortcutBinding, ShortcutOverrides } from "./contracts";
import { saveBindingDraft, saveDefaultBindings, type BindingDraft, type EditContext } from "./changes";

export type ShortcutEdit = { kind: "binding"; draft: BindingDraft } | { kind: "defaults"; expected: ShortcutOverrides };

export function useShortcutEditor(context: EditContext, overrides: ShortcutOverrides) {
  const [edit, setEdit] = useState<ShortcutEdit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const begin = (action?: ActionId) => {
    setError(null); setMessage(null);
    setEdit(action ? { kind: "binding", draft: { action, binding: overrides[action], original: overrides[action] } }
      : { kind: "defaults", expected: overrides });
  };
  const change = (binding: ShortcutBinding | null | undefined) => {
    setError(null);
    setEdit((current) => current?.kind === "binding" ? { ...current, draft: { ...current.draft, binding } } : current);
  };
  const cancel = () => { restoreEditorFocus(edit); setEdit(null); setError(null); };
  const save = () => {
    if (!edit) return;
    try {
      if (edit.kind === "binding") saveBindingDraft(edit.draft, context);
      else saveDefaultBindings(edit.expected, context);
      setMessage(edit.kind === "binding" ? "快捷键已保存，立即生效" : "已恢复当前平台的默认快捷键");
      cancel();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return { edit, error, message, begin, change, cancel, save };
}

function restoreEditorFocus(edit: ShortcutEdit | null) {
  const id = edit?.kind === "binding" ? `shortcut-edit-${edit.draft.action}` : "shortcut-reset-all";
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}
