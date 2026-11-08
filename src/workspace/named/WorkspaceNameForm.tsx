import { useFeedback, t, useTranslation } from "../../i18n";
import { useState } from "react";
import { MAX_WORKSPACE_NAME } from "./contracts";
import { composingKey } from "../../utils/keyboard";
import { guardComposingEnter } from "../../utils/keyboard";

export function WorkspaceNameForm({ initial, mode, onSave, onCancel }: {
  initial: string; mode: "create" | "rename";
  onSave: (name: string) => string | null; onCancel: () => void;
}) {
  useTranslation();
  const [name, setName] = useState(initial);
  const [error, setError] = useFeedback<string | null>(null);
  const title = mode === "create" ? t("workspace.WorkspaceNameForm.text_946897d107") : t("workspace.WorkspaceNameForm.text_5b252a8dac");
  return (
    <form onKeyDown={guardComposingEnter} className="named-workspaces__form" aria-label={title} onSubmit={(event) => {
      event.preventDefault();
      const failure = onSave(name);
      if (failure) setError(failure); else onCancel();
    }}>
      <label>{title}<input autoFocus aria-label={t("workspace.WorkspaceNameForm.text_22dc6ee0c6")} maxLength={MAX_WORKSPACE_NAME}
        value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !composingKey(event.nativeEvent)) {
            event.preventDefault(); event.stopPropagation(); onCancel();
          }
        }} /></label>
      {mode === "create" ? <p>{t("workspace.WorkspaceNameForm.text_e50507e967")}</p> : null}
      {error ? <p className="named-workspaces__error" role="alert">{error}</p> : null}
      <footer><button type="button" onClick={onCancel}>{t("workspace.WorkspaceNameForm.text_2cd0f3be87")}</button><button type="submit">{mode === "create" ? t("workspace.WorkspaceNameForm.text_cde2cd071d") : t("workspace.WorkspaceNameForm.text_a759dd2529")}</button></footer>
    </form>
  );
}
