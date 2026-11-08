import { formatList, formatNumber, t, useTranslation } from "../../i18n";
import { useCallback, useLayoutEffect, useRef, type CSSProperties } from "react";
import { AGENT_KINDS, type AgentKind } from "../../agent/contracts";
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

// 保留原有服务商页的排列顺序，其余 Agent 来自统一注册表。
const PROVIDER_AGENTS: AgentKind[] = ["claude", ...AGENT_KINDS.filter((kind) => kind !== "claude")];

function useProviderSegments(kind: AgentKind) {
  useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const active = element.querySelector<HTMLButtonElement>('[aria-selected="true"]');
      if (!active) return;
      element.style.setProperty("--segment-x", `${active.offsetLeft}px`);
      element.style.setProperty("--segment-y", `${active.offsetTop}px`);
      element.style.setProperty("--segment-width", `${active.offsetWidth}px`);
      element.style.setProperty("--segment-height", `${active.offsetHeight}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [kind]);
  return ref;
}

/**
 * Provider 分区：在官方端点与第三方中转之间切换各个 Agent CLI 的路由。
 *
 * 改的是 CLI 自己的配置文件，所以在 Belfry 之外直接敲 `claude` / `codex` 一样生效。
 */
function useProviderCardNodes() {
  useTranslation();
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
  useTranslation();
  const {
    providers, kind, setKind, draft, issue, setIssue, pendingRemove, setPendingRemove,
    configFiles, configLoading, configFailure, copiedPath, formNotice, edits, setEdits,
    savingPath, saveFailure, savedPath, dirtyPaths, group, list, conflicts, submit,
    loadConfig, closeDraft, openDraft, copyConfig, saveConfigFile, revertConfigFile,
    setDraft, setFormNotice,
    revealSecrets, enableSensitivePreview, hasApiKey,
  } = useProviderEditor(onGuardChange);

  const { nodes: nodeById, register: registerCardNode } = useProviderCardNodes();
  const segmentsRef = useProviderSegments(kind);
  return (
    <section aria-label={t("provider.ProviderSection.text_8b472fc10b")} className="provider-section">
      <ProviderSettingsHeader busy={providers.loading} editing={draft !== null}
        onAdd={() => openDraft({ ...EMPTY_DRAFT })} onReload={() => void providers.reload()} />
      <div className="provider-segments" ref={segmentsRef} data-active={kind} role="tablist" aria-label="Agent CLI">
        {PROVIDER_AGENTS.map((value) => (
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
          <span>{t(conflicts.some((item) => item.source === "shell") ? "provider.ProviderSection.shellOverride" : "provider.ProviderSection.processOverride", { names: formatList(conflicts.map((item) => item.name)) })}
          </span>
        </p>
      ) : null}

      {draft ? (
        <div className="provider-editor">
          <div className="provider-editor__toolbar">
            <button className="provider-editor__back" disabled={providers.loading || savingPath !== null} onClick={closeDraft} type="button">
              <ArrowLeft aria-hidden="true" size={ICON.sm} />
              <span>{t("provider.ProviderSection.text_56daae0b6b")}</span>
            </button>
            <span className="provider-editor__mode">{draft.id ? t("provider.ProviderSection.text_ee8417e33b") : t("provider.ProviderSection.text_9f923bbc94")}</span>
          </div>
          <div className="provider-editor__heading">
            <div>
              <p className="provider-editor__eyebrow">{AGENT_LABEL[kind]}</p>
              <h3>{draft.name.trim() || t("provider.ProviderSection.text_0d6aa21685")}</h3>
            </div>
            <span
              className={`provider-editor__status${
                draft.id !== null && group?.currentId === draft.id ? " is-current" : ""
              }`}
            >
              {draft.id !== null && group?.currentId === draft.id ? t("provider.ProviderSection.text_52eb49cfbe") : t("provider.ProviderSection.text_f95ea7f4c0")}
            </span>
          </div>
          <div className="provider-editor__body">
            <div className="provider-editor__form-column">
              <ProviderForm
                kind={kind}
                busy={providers.loading || savingPath !== null}
                draft={draft}
                hasApiKey={hasApiKey}
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
              <summary>{t("provider.ProviderSection.text_36a045ebcc")}<span>{t("provider.ProviderSection.text_68f4c7b0f6")}</span></summary>
            <ProviderConfigEditor
              copiedPath={copiedPath}
              dirtyPaths={dirtyPaths}
              draft={draft}
              hasApiKey={hasApiKey}
              revealSecrets={revealSecrets}
              onRevealSecrets={enableSensitivePreview}
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
            <p className="provider-hint">{t("provider.ProviderSection.text_3b0002eb6a")}</p>
          ) : (
            <>
              <div className="provider-routing-summary">
                <span>{t("provider.ProviderSection.text_8d30e0eb42")}</span>
                <strong>{group ? (group.currentId === null ? t("provider.ProviderSection.text_726c9ae341") : list.find((item) => item.id === group.currentId)?.name || t("provider.ProviderSection.text_6534bf83b0")) : t("provider.ProviderSection.text_c4cf69f358")}</strong>
                <p>{t("provider.ProviderSection.text_cc40fd24b5")}</p>
              </div>
              <ProviderOfficial active={group !== undefined && group.currentId === null}
                busy={providers.loading || group === undefined} onSelect={() => void providers.select(kind, null)} />
              <div className="provider-library-heading"><h3>{t("provider.ProviderSection.text_a438204251")}<span>{formatNumber(list.length)}</span></h3><span>{t("provider.ProviderSection.text_43612817e9")}</span></div>
              <div
                className="provider-list"
                // 列数上限交给 CSS：按实际服务商数等分，宽屏下不会 auto-fill 出空列。
                // 列表为空时这里渲染的是提示文案，退回 1 列让它占满宽度。
                style={{ "--provider-columns": Math.max(1, list.length) } as CSSProperties}
              >
                {providers.catalog !== null && group === undefined ? (
                  <p className="provider-hint">{t("provider.ProviderSection.text_bcf23bbbc9", { agent: AGENT_LABEL[kind] })}</p>
                ) : null}
                {group && list.length === 0 ? <p className="provider-empty">{t("provider.ProviderSection.text_574267009a")}</p> : null}
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
                    model={config.model || t("provider.ProviderSection.text_8a46967532")}
                    hasApiKey={config.hasApiKey}
                    nodeRef={registerCardNode(config.id)}
                  />
                ))}
              </div>
              <p className="provider-hint">{t(kind === "claude" ? "provider.ProviderSection.claudeActivation" : "provider.ProviderSection.sessionActivation", { agent: AGENT_LABEL[kind] })}</p>
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
