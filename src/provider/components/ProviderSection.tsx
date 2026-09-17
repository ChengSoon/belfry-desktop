import { useCallback, useRef } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { ICON } from "../../theme/sizing";
import { failureLabel } from "../../workspace/errors";
import { AGENT_LABEL, EMPTY_DRAFT, toDraft } from "../contracts";
import { ProviderConfigEditor } from "./ProviderConfigEditor";
import { ProviderForm } from "./ProviderForm";
import { ProviderOfficial } from "./ProviderOfficial";
import { ProviderCard } from "./ProviderCard";
import { ProviderSettingsHeader } from "./ProviderSettingsHeader";
import { RemoveConfirm } from "./RemoveConfirm";
import { shatterCard } from "./shatterCard";
import { useProviderEditor } from "./useProviderEditor";
import "../provider.css";

/**
 * Provider 分区：在官方端点与第三方中转之间切换各个 Agent CLI 的路由。
 *
 * 改的是 CLI 自己的配置文件，所以在 Belfry 之外直接敲 `claude` / `codex` 一样生效。
 */
function useProviderCardNodes() {
  const nodes = useRef(new Map<string, HTMLElement>());
  const callbacks = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const register = useCallback((id: string) => {
    const cached = callbacks.current.get(id);
    if (cached) return cached;
    const register = (node: HTMLElement | null) => {
      if (node) nodes.current.set(id, node);
      else nodes.current.delete(id);
    };
    callbacks.current.set(id, register);
    return register;
  }, []);
  return { nodes: nodes.current, register };
}

export function ProviderSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  const {
    providers, kind, setKind, draft, issue, setIssue, pendingRemove, setPendingRemove,
    configFiles, configLoading, configFailure, copiedPath, formNotice, edits, setEdits,
    savingPath, saveFailure, savedPath, dirtyPaths, group, list, conflicts, submit,
    loadConfig, closeDraft, openDraft, copyConfig, saveConfigFile, revertConfigFile,
    setDraft, setFormNotice,
  } = useProviderEditor(onGuardChange);

  const { nodes: nodeById, register: registerCardNode } = useProviderCardNodes();
  return (
    <section aria-label="全局 Provider 设置" className="provider-section">
      <ProviderSettingsHeader busy={providers.loading} editing={draft !== null}
        onAdd={() => openDraft({ ...EMPTY_DRAFT })} onReload={() => void providers.reload()} />
      <div className="provider-segments" data-active={kind} role="tablist" aria-label="Agent CLI">
        {(["claude", "codex", "pi"] as const).map((value) => (
          <button
            aria-selected={kind === value}
            className={kind === value ? "is-active" : undefined}
            disabled={draft !== null || providers.loading}
            key={value}
            onClick={() => {
              setKind(value);
              setIssue(null);
            }}
            role="tab"
            type="button"
          >
            {AGENT_LABEL[value]}
          </button>
        ))}
      </div>

      {conflicts.length > 0 ? (
        <p className="provider-warning" role="alert">
          <AlertTriangle aria-hidden="true" size={ICON.sm} />
          <span>
            环境变量 {conflicts.map((item) => item.name).join("、")} 会盖过这里的设置。
            {conflicts.some((item) => item.source === "shell")
              ? "去 shell 配置文件里删掉它才会生效。"
              : "它来自启动 Belfry 的进程环境。"}
          </span>
        </p>
      ) : null}

      {draft ? (
        <div className="provider-editor">
          <div className="provider-editor__toolbar">
            <button className="provider-editor__back" disabled={providers.loading || savingPath !== null} onClick={closeDraft} type="button">
              <ArrowLeft aria-hidden="true" size={ICON.sm} />
              <span>返回 provider 列表</span>
            </button>
            <span className="provider-editor__mode">{draft.id ? "编辑 provider" : "新增 provider"}</span>
          </div>
          <div className="provider-editor__heading">
            <div>
              <p className="provider-editor__eyebrow">{AGENT_LABEL[kind]}</p>
              <h3>{draft.name.trim() || "未命名 provider"}</h3>
            </div>
            <span
              className={`provider-editor__status${
                draft.id !== null && group?.currentId === draft.id ? " is-current" : ""
              }`}
            >
              {draft.id !== null && group?.currentId === draft.id ? "已选用" : "未启用"}
            </span>
          </div>
          <div className="provider-editor__body">
            <div className="provider-editor__form-column">
              <ProviderForm
                kind={kind}
                busy={providers.loading || savingPath !== null}
                draft={draft}
                issue={issue}
                onCancel={closeDraft}
                onChange={(next) => {
                  setDraft(next);
                  setIssue(null);
                  setFormNotice(null);
                }}
                onSubmit={submit}
              />
              {formNotice ? <p className="provider-notice">{formNotice}</p> : null}
            </div>
            <details className="provider-advanced">
              <summary>高级配置 <span>查看与编辑 CLI 原始文件</span></summary>
            <ProviderConfigEditor
              copiedPath={copiedPath}
              dirtyPaths={dirtyPaths}
              draft={draft}
              edits={edits}
              failure={configFailure}
              files={configFiles}
              kind={kind}
              loading={configLoading}
              onChange={(path, content) =>
                setEdits((current) => ({ ...current, [path]: content }))
              }
              onCopy={(file) => void copyConfig(file)}
              onReload={() => loadConfig(kind, draft)}
              onRevert={revertConfigFile}
              onSave={(file) => void saveConfigFile(file)}
              saveFailure={saveFailure}
              savedPath={savedPath}
              savingPath={savingPath}
            />
            </details>
          </div>
        </div>
      ) : (
        <>
          {providers.loading && providers.catalog === null ? (
            <p className="provider-hint">正在读取 provider…</p>
          ) : (
            <>
              <div className="provider-routing-summary">
                <span>当前选择</span>
                <strong>{group ? (group.currentId === null ? "官方登录" : list.find((item) => item.id === group.currentId)?.name || "配置不可用") : "尚未读取"}</strong>
                <p>已选用表示 CLI 路由配置，不代表连接已通过验证。</p>
              </div>
              <ProviderOfficial active={group !== undefined && group.currentId === null}
                busy={providers.loading || group === undefined} onSelect={() => void providers.select(kind, null)} />
              <div className="provider-library-heading"><h3>自定义服务 <span>{list.length}</span></h3><span>保存配置后，手动启用</span></div>
              <div className="provider-list">
                {providers.catalog !== null && group === undefined ? (
                  <p className="provider-hint">
                    没有读到 {AGENT_LABEL[kind]} 的 provider 数据，点上方刷新重试。
                  </p>
                ) : null}
                {group && list.length === 0 ? <p className="provider-empty">还没有自定义服务。点击右上角「新增 Provider」添加 API 端点。</p> : null}
                {list.map((config) => (
                  <ProviderCard
                    active={group?.currentId === config.id}
                    busy={providers.loading}
                    key={config.id}
                    label={config.name}
                    onEdit={() => openDraft(toDraft(config))}
                    onRemove={() => setPendingRemove(config)}
                    onSelect={() => void providers.select(kind, config.id)}
                    endpoint={config.baseUrl}
                    model={config.model || "沿用 CLI 模型"}
                    apiKey={config.apiKey}
                    nodeRef={registerCardNode(config.id)}
                  />
                ))}
              </div>
              <p className="provider-hint">{kind === "codex" ? "切换后，新开的 Codex 会话使用所选服务。" : kind === "claude" ? "切换后，Claude Code 的后续请求使用所选服务。" : "切换后，新开的 Pi 会话使用所选服务。"} 保存新配置后，点击「启用」应用。</p>
            </>
          )}
        </>
      )}

      {providers.failure ? (
        <p className="provider-error" role="alert">{failureLabel(providers.failure)}</p>
      ) : null}
      {providers.notice && !providers.failure ? (
        <p className="provider-notice">{providers.notice}</p>
      ) : null}

      {pendingRemove ? (
        <RemoveConfirm
          config={pendingRemove}
          isCurrent={group?.currentId === pendingRemove.id}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const target = nodeById.get(pendingRemove.id) ?? null;
            const id = pendingRemove.id;
            setPendingRemove(null);
            const shatter = target ? shatterCard(target) : null;
            void providers.remove(kind, id).then((ok) => {
              if (ok === undefined) shatter?.cancel();
            });
          }}
        />
      ) : null}
    </section>
  );
}
