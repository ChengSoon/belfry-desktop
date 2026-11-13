import { Notice } from "../../components/Notice";
import { t, useTranslation } from "../../i18n";
import "../configEditor.css";
import { RefreshCcw } from "lucide-react";
import type { AgentKind } from "../../workspace/contracts";
import { ICON } from "../../theme/sizing";
import { AGENT_LABEL, type ConfigFilePreview, type ProviderDraft } from "../contracts";

interface ProviderConfigEditorProps {
  kind: AgentKind;
  draft: ProviderDraft;
  hasApiKey?: boolean;
  revealSecrets: boolean;
  onRevealSecrets: () => void;
  files: ConfigFilePreview[] | null;
  loading: boolean;
  failure: string | null;
  edits: Record<string, string>;
  dirtyPaths: ReadonlySet<string>;
  savingPath: string | null;
  saveFailure: string | null;
  savedPath: string | null;
  copiedPath: string | null;
  onReload: () => void;
  onChange: (path: string, content: string) => void;
  onCopy: (file: ConfigFilePreview) => void;
  onSave: (file: ConfigFilePreview) => void;
  onRevert: (path: string) => void;
}

/**
 * 编辑态才出现的 CLI 原始配置。列表页不挂载它，避免密钥和大段 JSON
 * 在常态界面里占据主要视觉注意力。
 */
export function ProviderConfigEditor({
  kind,
  draft,
  hasApiKey = false,
  revealSecrets,
  onRevealSecrets,
  files,
  loading,
  failure,
  edits,
  dirtyPaths,
  savingPath,
  saveFailure,
  savedPath,
  copiedPath,
  onReload,
  onChange,
  onCopy,
  onSave,
  onRevert,
}: ProviderConfigEditorProps) {
  useTranslation();
  return (
    <section aria-labelledby="provider-config-title" className="provider-config">
      <header className="provider-config__head">
        <div>
          <p className="provider-config__eyebrow">{t("provider.ProviderConfigEditor.text_6c425af86e")}</p>
          <h3 id="provider-config-title">{t("provider.ProviderConfigEditor.text_e5b4f26727", { agent: AGENT_LABEL[kind] })}</h3>
        </div>
        <button
          aria-label={t("provider.ProviderConfigEditor.text_31f996efae")}
          className="provider-config__reload"
          disabled={!revealSecrets || loading || dirtyPaths.size > 0}
          onClick={onReload}
          title={dirtyPaths.size > 0 ? t("provider.ProviderConfigEditor.text_86e80d0720") : t("provider.ProviderConfigEditor.text_df7392cc96")}
          type="button"
        >
          <RefreshCcw aria-hidden="true" size={ICON.xs} />
        </button>
      </header>

      <div className="provider-config__identity" aria-label={t("provider.ProviderConfigEditor.text_b80de03ab2")}>
        <div>
          <span>{t("provider.ProviderConfigEditor.text_d44e9b3d3b")}</span>
          <strong>{draft.name.trim() || t("provider.ProviderConfigEditor.text_0d6aa21685")}</strong>
        </div>
        <div>
          <span>{t("provider.ProviderConfigEditor.text_52fff1680d")}</span>
          <code>{draft.baseUrl.trim() || t("provider.ProviderConfigEditor.text_4f28ec4839")}</code>
        </div>
        <div>
          <span>API Key</span>
          <code>{draft.apiKeyAction === "keep" ? (hasApiKey ? t("provider.ProviderConfigEditor.text_8650374f07") : t("provider.ProviderConfigEditor.text_9bfed3e678")) : draft.apiKeyAction === "clear" ? t("provider.ProviderConfigEditor.text_314f996082") : t("provider.ProviderConfigEditor.text_16a8f87aa7")}</code>
        </div>
        <div>
          <span>{t("provider.ProviderConfigEditor.text_c98e118e0a")}</span>
          <code>{draft.model.trim() || t("provider.ProviderConfigEditor.text_078d4f7d72")}</code>
        </div>
      </div>

      <p className="provider-config__hint">{t("provider.ProviderConfigEditor.text_4e099bae7c")}</p>

      {!revealSecrets ? (
        <button className="provider-config__copy" type="button" onClick={onRevealSecrets}>{t("provider.ProviderConfigEditor.text_df893a06ba")}</button>
      ) : <>
      {failure ? <Notice className="provider-error" role="alert">{failure}</Notice> : null}
      {saveFailure ? <Notice className="provider-error" role="alert">{saveFailure}</Notice> : null}
      {loading && files === null ? <p className="provider-config__hint">{t("provider.ProviderConfigEditor.text_86b6d0d630")}</p> : null}
      {files && files.length === 0 ? <p className="provider-config__hint">{t("provider.ProviderConfigEditor.text_16b0c4444d")}</p> : null}

      {files?.map((file) => (
        <div className="provider-config__file" key={file.path}>
          <div className="provider-config__file-head">
            <code className="provider-config__path" title={file.path}>{file.path}</code>
            <span className={`provider-config__badge provider-config__badge--${file.format}`}>
              {file.format.toUpperCase()}
            </span>
            {dirtyPaths.has(file.path) ? (
              <>
                <button
                  className="provider-config__save"
                  disabled={savingPath === file.path}
                  onClick={() => onSave(file)}
                  type="button"
                >
                  {savingPath === file.path ? t("provider.ProviderConfigEditor.text_ff509c9ba0") : t("provider.ProviderConfigEditor.text_a3030bf8f1")}
                </button>
                <button
                  className="provider-config__copy"
                  disabled={savingPath === file.path}
                  onClick={() => onRevert(file.path)}
                  type="button"
                >{t("provider.ProviderConfigEditor.text_ddde089462")}</button>
              </>
            ) : null}
            <button className="provider-config__copy" onClick={() => onCopy(file)} type="button">
              {copiedPath === file.path ? t("provider.ProviderConfigEditor.text_8f6f8d979c") : t("provider.ProviderConfigEditor.text_63d90d9773")}
            </button>
            {savedPath === file.path ? <span className="provider-config__saved">{t("provider.ProviderConfigEditor.text_1bd91a7d0c")}</span> : null}
          </div>
          <textarea
            aria-label={t("provider.ProviderConfigEditor.text_fae49cc380", { path: file.path })}
            className="provider-config__editor"
            disabled={savingPath === file.path}
            onChange={(event) => onChange(file.path, event.target.value)}
            placeholder={t("provider.ProviderConfigEditor.text_92b9eaea92")}
            spellCheck={false}
            value={edits[file.path] ?? file.content}
          />
        </div>
      ))}
      </>}
    </section>
  );
}
