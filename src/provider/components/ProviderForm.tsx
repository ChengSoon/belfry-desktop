import { t, useTranslation } from "../../i18n";
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
  useTranslation();
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
  useTranslation();
  const [showKey, setShowKey] = useState(false);
  const nativeModel = ["antigravity", "opencode", "kimi"].includes(kind);
  const baseHint = kind === "antigravity"
    ? t("provider.ProviderForm.text_620345af26")
    : kind === "opencode" || kind === "kimi"
      ? t("provider.ProviderForm.text_36975fa792")
      : t("provider.ProviderForm.text_a4b2fa6ec3");
  const field = (key: FieldName) => ({
    id: `provider-${key}`, value: draft[key], disabled: busy,
    "aria-invalid": issue?.field === key,
    "aria-describedby": `provider-${key}-hint`,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: event.target.value }),
  });
  return <form onKeyDown={guardComposingEnter} className="provider-form" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
    <fieldset disabled={busy}>
      <legend><span>01</span>{t("provider.ProviderForm.text_e1fccaa4b2")}</legend>
      <FormField name="name" label={t("provider.ProviderForm.text_5df7bfb4b7")} hint={t("provider.ProviderForm.text_37d73bcc6e")} issue={issue}>
        <input autoFocus placeholder={t("provider.ProviderForm.text_c28a587b8d")} {...field("name")} />
      </FormField>
      <FormField name="baseUrl" label="Base URL" hint={baseHint} issue={issue}>
        <input placeholder="https://api.example.com" spellCheck={false} autoCapitalize="none" {...field("baseUrl")} />
      </FormField>
      <div className="provider-form__row">
        <label htmlFor="provider-apiKeyAction">{t(hasApiKey ? "provider.ProviderForm.keyConfigured" : "provider.ProviderForm.keyMissing")}</label>
        <select id="provider-apiKeyAction" value={draft.apiKeyAction}
          onChange={(event) => {
            setShowKey(false);
            onChange({ ...draft, apiKey: "", apiKeyAction: event.target.value as ProviderDraft["apiKeyAction"] });
          }}>
          <option value="keep" disabled={draft.id === null}>{t("provider.ProviderForm.text_e713f5063b")}</option>
          <option value="replace">{t("provider.ProviderForm.text_2570de8c06")}</option>
          <option value="clear">{t("provider.ProviderForm.text_f8cd7628c0")}</option>
        </select>
      </div>
      <FormField name="apiKey" label="API Key" hint={t("provider.ProviderForm.text_68ce1f7509")} issue={issue}>
        <div className="provider-form__secret">
          <input placeholder={t("provider.ProviderForm.text_8acacb952c")} spellCheck={false} autoComplete="off" type={showKey ? "text" : "password"} {...field("apiKey")}
            onChange={(event) => onChange({ ...draft, apiKey: event.target.value, apiKeyAction: "replace" })} />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label={showKey ? t("provider.ProviderForm.text_86b7355ec3") : t("provider.ProviderForm.text_f2bdc88464")} aria-pressed={showKey}>
            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </FormField>
    </fieldset>
    <fieldset disabled={busy}>
      <legend><span>02</span>{t("provider.ProviderForm.text_7e5d67cd62")}<small>{nativeModel ? t("provider.ProviderForm.text_11da9dc442") : t("provider.ProviderForm.text_537352400c")}</small></legend>
      <ProviderModelField kind={kind} draft={draft} busy={busy} onChange={onChange} issue={issue} />
    </fieldset>
    <div className="provider-form__footer">
      <p className="provider-form__hint">{t("provider.ProviderForm.text_7d725f4645")}</p>
      <div className="modal__actions">
        <button disabled={busy} onClick={onCancel} type="button">{t("provider.ProviderForm.text_2cd0f3be87")}</button>
        <button className="modal__primary" disabled={busy} type="submit">{busy ? t("provider.ProviderForm.text_ff509c9ba0") : t("provider.ProviderForm.text_6e584e3d5c")}</button>
      </div>
    </div>
  </form>;
}
