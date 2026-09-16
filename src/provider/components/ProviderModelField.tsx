import { useEffect, useRef, useState } from "react";
import { Combobox } from "../../components/controls/Combobox";
import { RefreshCcw } from "lucide-react";
import type { AgentKind } from "../../workspace/contracts";
import { toAppFailure } from "../../workspace/errors";
import { fetchProviderModels } from "../api";
import type { ProviderDraft } from "../contracts";

export function ProviderModelField({ kind, draft, busy, onChange }: {
  kind: AgentKind; draft: ProviderDraft; busy: boolean; onChange: (draft: ProviderDraft) => void;
}) {
  const [models, setModels] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  useEffect(() => {
    version.current += 1;
    setModels(null); setError(null); setLoading(false);
    return () => { version.current += 1; };
  }, [kind, draft.baseUrl, draft.apiKey]);
  const fetchModels = async () => {
    const request = ++version.current;
    setLoading(true); setError(null); setModels(null);
    try {
      const result = await fetchProviderModels(kind, draft.baseUrl, draft.apiKey);
      if (request === version.current) setModels(result);
    } catch (failure) {
      if (request === version.current) setError(toAppFailure(failure).message);
    } finally {
      if (request === version.current) setLoading(false);
    }
  };
  return <div className="provider-form__row">
    <span className="provider-model__label">默认模型</span>
    <div className="provider-model__input">
      <ModelInput models={models} value={draft.model} busy={busy} onChange={(model) => onChange({ ...draft, model })} />
      <button type="button" disabled={busy || loading || !draft.baseUrl.trim()} onClick={() => void fetchModels()}>
        <RefreshCcw size={14} aria-hidden="true" className={loading ? "is-loading" : undefined} />{loading ? "获取中…" : "获取模型"}
      </button>
    </div>
    {error && <p className="provider-form__issue" role="alert">{error}</p>}
    <p className="provider-form__hint" role="status">{models?.length === 0 ? "服务未返回模型，可手动填写模型 ID。" : models ? `已获取 ${models.length} 个模型，选择后再保存配置。` : ""}</p>
    <p id="provider-model-hint" className="provider-form__hint">使用当前地址和密钥获取服务公布的模型，不验证调用权限。也可手动填写，留空沿用 CLI 设置。</p>
  </div>;
}

export function ModelInput({ models, value, busy, onChange }: {
  models: string[] | null; value: string; busy: boolean; onChange: (value: string) => void;
}) {
  if (models?.length) return <Combobox ariaLabel="默认模型" value={value} disabled={busy}
    options={models.map((model) => ({ value: model, label: model }))} onChange={onChange}
    placeholder="输入或选择模型" openOnFocus />;
  return <input id="provider-model" aria-label="默认模型" aria-describedby="provider-model-hint"
    disabled={busy} value={value} onChange={(event) => onChange(event.target.value)}
    placeholder="输入模型 ID，或从服务获取" spellCheck={false} />;
}
