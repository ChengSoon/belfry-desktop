import type { ProviderDraft } from "../contracts";
import type { DraftIssue } from "../validate";

interface ProviderFormProps {
  busy: boolean;
  draft: ProviderDraft;
  issue: DraftIssue | null;
  onCancel: () => void;
  onChange: (draft: ProviderDraft) => void;
  onSubmit: () => void;
}

export function ProviderForm({ busy, draft, issue, onCancel, onChange, onSubmit }: ProviderFormProps) {
  const field = (key: keyof Omit<ProviderDraft, "id">) => ({
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      onChange({ ...draft, [key]: event.target.value }),
    value: draft[key],
  });

  return (
    <form
      className="provider-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="provider-form__row">
        <span>名称</span>
        <input autoFocus placeholder="给它起个好认的名字" {...field("name")} />
      </label>
      <label className="provider-form__row">
        <span>Base URL</span>
        <input placeholder="https://…" spellCheck={false} {...field("baseUrl")} />
      </label>
      <label className="provider-form__row">
        <span>API Key</span>
        <input placeholder="sk-…" spellCheck={false} type="password" {...field("apiKey")} />
      </label>
      <label className="provider-form__row">
        <span>模型</span>
        <input placeholder="留空则沿用现有设置" spellCheck={false} {...field("model")} />
      </label>

      {issue ? (
        <p className="provider-form__issue" role="alert">{issue.message}</p>
      ) : (
        <p className="provider-form__hint">
          Key 以明文存在 Belfry 的配置文件里（仅本人可读）。
        </p>
      )}

      <div className="modal__actions">
        <button onClick={onCancel} type="button">取消</button>
        <button className="modal__primary" disabled={busy} type="submit">
          {busy ? "保存中…" : "保存 provider"}
        </button>
      </div>
    </form>
  );
}
