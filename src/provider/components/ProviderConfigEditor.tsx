import { RefreshCcw } from "lucide-react";
import type { AgentKind } from "../../workspace/contracts";
import { ICON } from "../../theme/sizing";
import { AGENT_LABEL, type ConfigFilePreview, type ProviderDraft } from "../contracts";
import { maskKey } from "../validate";

interface ProviderConfigEditorProps {
  kind: AgentKind;
  draft: ProviderDraft;
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
          disabled={loading || dirtyPaths.size > 0}
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
          <code>{maskKey(draft.apiKey)}</code>
        </div>
        <div>
          <span>模型</span>
          <code>{draft.model.trim() || "CLI 默认模型"}</code>
        </div>
      </div>

      <p className="provider-config__hint">
        这里显示将当前 Provider 套用到 CLI 配置后的完整预览（含密钥，仅保存在本机），
        路由之外的配置字段保持原样；左侧字段会实时同步到这里。
        可直接编辑保存；保存前会校验 JSON/TOML，改坏了不会落盘。未启用的条目保存后，仍需从列表选中才会写入 CLI。
      </p>

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
    </section>
  );
}
