import { useFeedback, t, useTranslation } from "../../i18n";
import { useEffect, useRef, useState } from "react";
import { Combobox } from "../../components/controls/Combobox";
import { RefreshCcw } from "lucide-react";
import type { AgentKind } from "../../workspace/contracts";
import { toAppFailure } from "../../workspace/errors";
import { fetchProviderModels } from "../api";
import type { ProviderDraft } from "../contracts";
import type { DraftIssue } from "../validate";

export function ProviderModelField({ kind, draft, busy, onChange, issue }: {
  kind: AgentKind; draft: ProviderDraft; busy: boolean; onChange: (draft: ProviderDraft) => void;
  issue?: DraftIssue | null;
}) {
  useTranslation();
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useFeedback<string | null>(null);
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    setModels(null); setError(null); setLoading(false);
    return () => { version.current += 1; };
  }, [kind, draft.id, draft.baseUrl, draft.apiKey, draft.apiKeyAction]);
  const fetchModels = async () => {
    const request = ++version.current;
    setLoading(true); setError(null); setModels(null);
    try {
      const result = await fetchProviderModels(kind, draft);
      if (request === version.current) setModels(result);
    } catch (failure) {
      if (request === version.current) setError(() => toAppFailure(failure).message);
    } finally {
      if (request === version.current) setLoading(false);
    }
  };
  return <div className="provider-form__row">
    <span className="provider-model__label">{t("provider.ProviderModelField.text_1e2933c6b8")}</span>
    <div className="provider-model__input">
      <ModelInput models={models} value={draft.model} busy={busy} onChange={(model) => onChange({ ...draft, model })} />
      <button type="button" disabled={busy || loading || !draft.baseUrl.trim()} onClick={() => void fetchModels()}>
        <RefreshCcw size={14} aria-hidden="true" className={loading ? "is-loading" : undefined} />{loading ? t("provider.ProviderModelField.text_146da2e2a9") : t("provider.ProviderModelField.text_83fcfb4c1f")}
      </button>
    </div>
    {error && <p className="provider-form__issue" role="alert">{error}</p>}
    <p className="provider-form__hint" role="status">{models?.length === 0 ? t("provider.ProviderModelField.text_68f04a2985") : models ? t("provider.ProviderModelField.text_366a064958", { count: models.length }) : ""}</p>
    {issue?.field === "model" && <p className="provider-form__issue" role="alert">{issue.message}</p>}
    <p id="provider-model-hint" className="provider-form__hint">{t(["antigravity", "opencode", "kimi"].includes(kind) ? "provider.ProviderModelField.requiredHint" : "provider.ProviderModelField.optionalHint")}</p>
  </div>;
}

export function ModelInput({ models, value, busy, onChange }: {
  models: string[] | null; value: string; busy: boolean; onChange: (value: string) => void;
}) {
  useTranslation();
  if (models?.length) return <Combobox ariaLabel={t("provider.ProviderModelField.text_1e2933c6b8")} value={value} disabled={busy}
    options={models.map((model) => ({ value: model, label: model }))} onChange={onChange}
    placeholder={t("provider.ProviderModelField.text_dac7cd2c9e")} openOnFocus />;
  return <input id="provider-model" aria-label={t("provider.ProviderModelField.text_1e2933c6b8")} aria-describedby="provider-model-hint"
    disabled={busy} value={value} onChange={(event) => onChange(event.target.value)}
    placeholder={t("provider.ProviderModelField.text_3c0c5bde8f")} spellCheck={false} />;
}
