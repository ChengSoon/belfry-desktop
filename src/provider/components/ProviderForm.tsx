import { ProviderModelField } from "./ProviderModelField";
import type { AgentKind } from "../../workspace/contracts";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import type { ProviderDraft } from "../contracts";
import type { DraftIssue } from "../validate";
import { guardComposingEnter } from "../../utils/keyboard";

interface ProviderFormProps {
  busy: boolean;
  kind: AgentKind;
  draft: ProviderDraft;
  hasApiKey?: boolean;
  issue: DraftIssue | null;
  onCancel: () => void;
  onChange: (draft: ProviderDraft) => void;
  onSubmit: () => void;
}

type FieldName = keyof Omit<ProviderDraft, "id">;
function FormField({ name, label, hint, children, issue }: {
  name: FieldName; label: string; hint: string; children: React.ReactNode; issue: DraftIssue | null;
}) {
  const error = issue?.field === name;
  return <div className="provider-form__row">
    <label htmlFor={`provider-${name}`}>{label}</label>
    {children}
    <p id={`provider-${name}-hint`} className={error ? "provider-form__issue" : "provider-form__hint"} role={error ? "alert" : undefined}>
      {error ? issue.message : hint}
    </p>
  </div>;
}

export function ProviderForm({ kind, busy, draft, hasApiKey = false, issue, onCancel, onChange, onSubmit }: ProviderFormProps) {
  const [showKey, setShowKey] = useState(false);
  const field = (key: FieldName) => ({
    id: `provider-${key}`, value: draft[key], disabled: busy,
    "aria-invalid": issue?.field === key,
    "aria-describedby": `provider-${key}-hint`,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value }),
  });
  return <form onKeyDown={guardComposingEnter} className="provider-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <fieldset disabled={busy}>
      <legend><span>01</span> 连接服务</legend>
      <FormField name="name" label="服务名称" hint="用用途或供应商命名，方便切换时识别。" issue={issue}>
        <input autoFocus placeholder="例如：团队共享 · 主力服务" {...field("name")} />
      </FormField>
      <FormField name="baseUrl" label="Base URL" hint="填写服务商提供的完整 API 基础地址，保留要求的路径。" issue={issue}>
        <input placeholder="https://api.example.com" spellCheck={false} autoCapitalize="none" {...field("baseUrl")} />
      </FormField>
      <div className="provider-form__row">
        <label htmlFor="provider-apiKeyAction">密钥操作（{hasApiKey ? "已配置密钥" : "未配置密钥"}）</label>
        <select id="provider-apiKeyAction" value={draft.apiKeyAction}
          onChange={(event) => {
            setShowKey(false);
            onChange({ ...draft, apiKey: "", apiKeyAction: event.target.value as ProviderDraft["apiKeyAction"] });
          }}>
          <option value="keep" disabled={draft.id === null}>保留现有密钥</option>
          <option value="replace">替换密钥</option>
          <option value="clear">清除密钥（无需认证）</option>
        </select>
      </div>
      <FormField name="apiKey" label="API Key" hint="仅输入新密钥，输入即选择替换。留空不会清除已保存的密钥，请显式选择清除。更改 Base URL 后须替换或清除。" issue={issue}>
        <div className="provider-form__secret">
          <input placeholder="输入新 API Key" spellCheck={false} autoComplete="off" type={showKey ? "text" : "password"} {...field("apiKey")}
            onChange={(event) => onChange({ ...draft, apiKey: event.target.value, apiKeyAction: "replace" })} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} aria-pressed={showKey}>
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </FormField>
    </fieldset>
    <fieldset disabled={busy}>
      <legend><span>02</span> 模型偏好 <small>可选</small></legend>
      <ProviderModelField kind={kind} draft={draft} busy={busy} onChange={onChange} />
    </fieldset>
    <div className="provider-form__footer">
      <p className="provider-form__hint">Belfry 加密保存密钥，由系统凭据存储保护；外部 CLI 配置仍可能以明文保存密钥。</p>
      <div className="modal__actions">
        <button disabled={busy} onClick={onCancel} type="button">取消</button>
        <button className="modal__primary" disabled={busy} type="submit">{busy ? "保存中…" : "保存配置"}</button>
      </div>
    </div>
  </form>;
}
