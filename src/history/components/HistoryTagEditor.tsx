import { useState, type FormEvent } from "react";
import { normalizeTags } from "../metadata";

interface Props {
  tags: string[];
  onSave: (tags: string[]) => boolean | void;
  onClose: () => void;
}

export function HistoryTagEditor({ tags, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(tags.join("，"));
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    try {
      if (onSave(normalizeTags(draft)) !== false) onClose();
      else setError("标签保存失败，请查看上方错误提示。");
    } catch (error) { setError(error instanceof Error ? error.message : "无法保存标签。"); }
  };
  return <form className="history-tag-editor" onSubmit={submit} onKeyDown={(event) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
  }}>
    <label><span>标签，用逗号分隔</span><input autoFocus aria-label="会话标签" value={draft}
      placeholder="例如：回归，待复查" onChange={(event) => setDraft(event.target.value)} /></label>
    <div><button type="button" onClick={onClose}>取消</button><button type="submit">保存标签</button></div>
    {error ? <p role="alert">{error}</p> : null}
  </form>;
}
