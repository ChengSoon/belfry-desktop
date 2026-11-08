import { useFeedback, t, useTranslation } from "../../i18n";
import { useState, type FormEvent } from "react";
import { normalizeTags } from "../metadata";
import { composingKey, guardComposingEnter } from "../../utils/keyboard";

interface Props {
  tags: string[];
  onSave: (tags: string[]) => boolean | void;
  onClose: () => void;
}

export function HistoryTagEditor({ tags, onSave, onClose }: Props) {
  useTranslation();
  const [draft, setDraft] = useState(tags.join(", "));
  const [error, setError] = useFeedback<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (onSave(normalizeTags(draft)) !== false) onClose();
      else setError(() => t("history.HistoryTagEditor.text_d9db4a949b"));
    } catch (error) { setError(() => error instanceof Error ? error.message : t("history.HistoryTagEditor.text_b4a05d85c6")); }
  };
  return <form className="history-tag-editor" onSubmit={submit} onKeyDown={(event) => {
    // 选词回车的默认动作先挡住（表单隐式提交）；组字中的 Escape 是「取消候选」，不关编辑器。
    guardComposingEnter(event);
    if (composingKey(event.nativeEvent)) return;
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <label><span>{t("history.HistoryTagEditor.text_1fd96725a9")}</span><input autoFocus aria-label={t("history.HistoryTagEditor.text_2c70d3e409")} value={draft}
      placeholder={t("history.HistoryTagEditor.text_798e599684")} onChange={(event) => setDraft(event.target.value)} /></label>
    <div><button type="button" onClick={onClose}>{t("history.HistoryTagEditor.text_2cd0f3be87")}</button><button type="submit">{t("history.HistoryTagEditor.text_277c532bb9")}</button></div>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
