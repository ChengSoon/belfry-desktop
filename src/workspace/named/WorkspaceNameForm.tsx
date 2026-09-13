import { useState } from "react";
import { MAX_WORKSPACE_NAME } from "./contracts";

export function WorkspaceNameForm({ initial, mode, onSave, onCancel }: {
  initial: string; mode: "create" | "rename";
  onSave: (name: string) => string | null; onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const title = mode === "create" ? "新建工作区" : "重命名工作区";
  return (
    <form className="named-workspaces__form" aria-label={title} onSubmit={(event) => {
      event.preventDefault();
      const failure = onSave(name);
      if (failure) setError(failure); else onCancel();
    }}>
      <label>{title}<input autoFocus aria-label="工作区名称" maxLength={MAX_WORKSPACE_NAME}
        value={name} onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault(); event.stopPropagation(); onCancel();
          }
        }} /></label>
      {mode === "create" ? <p>新建空工作区，随后按需添加会话。</p> : null}
      {error ? <p className="named-workspaces__error" role="alert">{error}</p> : null}
      <footer><button type="button" onClick={onCancel}>取消</button><button type="submit">{mode === "create" ? "创建" : "保存名称"}</button></footer>
    </form>
  );
}
