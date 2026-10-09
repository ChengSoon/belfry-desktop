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
  return (
    <section aria-labelledby="provider-config-title" className="provider-config">
      <header className="provider-config__head">
        <div>
          <p className="provider-config__eyebrow">配置预览</p>
          <h3 id="provider-config-title">{AGENT_LABEL[kind]} 配置</h3>
        </div>
        <button
          aria-label="重新读取配置文件"
          className="provider-config__reload"
          disabled={!revealSecrets || loading || dirtyPaths.size > 0}
          onClick={onReload}
          title={dirtyPaths.size > 0 ? "有未保存的修改，先保存或还原" : "重新读取"}
          type="button"
        >
          <RefreshCcw aria-hidden="true" size={ICON.xs} />
        </button>
      </header>

      <div className="provider-config__identity" aria-label="当前编辑的 provider 信息">
        <div>
          <span>名称</span>
          <strong>{draft.name.trim() || "未命名 provider"}</strong>
        </div>
        <div>
          <span>端点</span>
          <code>{draft.baseUrl.trim() || "待填写"}</code>
        </div>
        <div>
          <span>API Key</span>
          <code>{draft.apiKeyAction === "keep" ? (hasApiKey ? "已配置密钥（保留）" : "未配置密钥（保留）") : draft.apiKeyAction === "clear" ? "将清除密钥" : "将替换密钥"}</code>
        </div>
        <div>
          <span>模型</span>
          <code>{draft.model.trim() || "CLI 默认模型"}</code>
        </div>
      </div>

      <p className="provider-config__hint">
        原始配置包含外部 CLI 的完整密钥及其他敏感字段，外部 CLI 配置仍可能为明文。
        查看后表单字段会实时同步到预览；复制会将全部原文（含密钥）放入剪贴板，请勿分享或粘贴到不可信位置。
        直接保存原始文件会写入当前 CLI 配置并同步服务列表。仅保存上方表单时，未启用的条目仍需在列表点击「启用」。
      </p>

      {!revealSecrets ? (
        <button className="provider-config__copy" type="button" onClick={onRevealSecrets}>查看含密钥的原始配置</button>
      ) : <>
      {failure ? <p className="provider-error" role="alert">{failure}</p> : null}
      {saveFailure ? <p className="provider-error" role="alert">{saveFailure}</p> : null}
      {loading && files === null ? <p className="provider-config__hint">正在读取…</p> : null}
      {files && files.length === 0 ? <p className="provider-config__hint">还没有配置文件。</p> : null}

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
                  {savingPath === file.path ? "保存中…" : "保存"}
                </button>
                <button
                  className="provider-config__copy"
                  disabled={savingPath === file.path}
                  onClick={() => onRevert(file.path)}
                  type="button"
                >
                  还原
                </button>
              </>
            ) : null}
            <button className="provider-config__copy" onClick={() => onCopy(file)} type="button">
              {copiedPath === file.path ? "已复制" : "复制"}
            </button>
            {savedPath === file.path ? <span className="provider-config__saved">已保存</span> : null}
          </div>
          <textarea
            aria-label={`编辑 ${file.path}`}
            className="provider-config__editor"
            disabled={savingPath === file.path}
            onChange={(event) => onChange(file.path, event.target.value)}
            placeholder="文件还不存在，可在这里输入完整配置"
            spellCheck={false}
            value={edits[file.path] ?? file.content}
          />
        </div>
      ))}
      </>}
    </section>
  );
}
