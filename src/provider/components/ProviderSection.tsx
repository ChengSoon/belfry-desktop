import { AlertTriangle, ArrowLeft, Check, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { AgentKind } from "../../workspace/contracts";
import { failureLabel, toAppFailure } from "../../workspace/errors";
import { useDismiss } from "../../workspace/useDismiss";
import { configPreview, configSave } from "../api";
import {
  AGENT_LABEL,
  EMPTY_DRAFT,
  type ConfigFilePreview,
  type ProviderConfig,
  type ProviderDraft,
  toDraft,
} from "../contracts";
import { useProviders } from "../useProviders";
import { type DraftIssue, maskKey, validateDraft } from "../validate";
import { ProviderConfigEditor } from "./ProviderConfigEditor";
import { ProviderForm } from "./ProviderForm";
import "../provider.css";

/**
 * Provider 分区：在官方端点与第三方中转之间切换各个 Agent CLI 的路由。
 *
 * 改的是 CLI 自己的配置文件，所以在 Belfry 之外直接敲 `claude` / `codex` 一样生效。
 */
export function ProviderSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  const providers = useProviders(true);
  const [kind, setKind] = useState<AgentKind>("claude");
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [issue, setIssue] = useState<DraftIssue | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProviderConfig | null>(null);
  const [configFiles, setConfigFiles] = useState<ConfigFilePreview[] | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configFailure, setConfigFailure] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const configRequest = useRef(0);
  /** 正在编辑的文件原文，按 agent 分开存。
      path → 编辑中的内容。与 configFiles 里的原文不一致才算脏。 */
  const [editsByKind, setEditsByKind] = useState<Record<AgentKind, Record<string, string>>>({
    claude: {},
    codex: {},
  });
  const edits = editsByKind[kind];
  const setEdits = (updater: (current: Record<string, string>) => Record<string, string>) => {
    setEditsByKind((all) => ({ ...all, [kind]: updater(all[kind]) }));
  };
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const dirtyPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const file of configFiles ?? []) {
      const edited = edits[file.path];
      if (edited !== undefined && edited !== file.content) paths.add(file.path);
    }
    return paths;
  }, [configFiles, edits]);
  const hasDirty = dirtyPaths.size > 0;

  // 表单或配置编辑到一半时，一次误触关闭就把改动全丢了，所以让外壳先别响应退出手势。
  useEffect(() => {
    onGuardChange(draft !== null || hasDirty);
    return () => onGuardChange(false);
  }, [draft, hasDirty, onGuardChange]);

  const group = providers.catalog?.agents.find((item) => item.kind === kind);
  const list = useMemo(() => group?.providers ?? [], [group]);

  const conflicts = useMemo(
    () => providers.catalog?.envConflicts.filter((item) => item.kind === kind) ?? [],
    [kind, providers.catalog],
  );

  const submit = () => {
    if (!draft) return;
    if (savingPath !== null) {
      setFormNotice("配置文件正在保存，请稍候再保存 provider 信息。");
      return;
    }
    if (hasDirty) {
      setFormNotice("配置文件还有未保存的修改，请先保存或还原，再保存 provider 信息。");
      return;
    }
    const found = validateDraft(draft, list);
    setIssue(found);
    if (found) return;
    setFormNotice(null);
    void providers.save(kind, draft).then((catalog) => {
      if (catalog) closeDraft();
    });
  };

  const loadConfig = useCallback((agentKind: AgentKind, previewDraft?: ProviderDraft) => {
    const request = ++configRequest.current;
    setConfigLoading(true);
    setConfigFailure(null);
    configPreview(agentKind, previewDraft)
      .then((files) => {
        if (request === configRequest.current) setConfigFiles(files);
      })
      .catch((error) => {
        if (request === configRequest.current) setConfigFailure(failureLabel(toAppFailure(error)));
      })
      .finally(() => {
        if (request === configRequest.current) setConfigLoading(false);
      });
  }, []);

  const clearConfigEditor = () => {
    configRequest.current += 1;
    setConfigFiles(null);
    setConfigLoading(false);
    setConfigFailure(null);
    setSaveFailure(null);
    setCopiedPath(null);
    setSavedPath(null);
    setEditsByKind((all) => ({ ...all, [kind]: {} }));
  };

  const closeDraft = () => {
    setDraft(null);
    setIssue(null);
    setFormNotice(null);
    clearConfigEditor();
  };

  const openDraft = (next: ProviderDraft) => {
    providers.dismissNotice();
    setIssue(null);
    setFormNotice(null);
    setDraft(next);
    clearConfigEditor();
  };

  // 左侧字段是 Provider 草稿的主来源。输入变化后重新生成一份内存预览，
  // 右侧因此始终显示同一个 Base URL / Key / model，而不会继续沿用旧 live 文件。
  const draftPreviewKey = draft ? JSON.stringify(draft) : null;
  useEffect(() => {
    if (!draft) return;
    const previewDraft = { ...draft };
    configRequest.current += 1;
    setConfigFiles(null);
    setConfigLoading(true);
    setConfigFailure(null);
    setSaveFailure(null);
    setSavedPath(null);
    setEditsByKind((all) => ({ ...all, [kind]: {} }));
    const timer = window.setTimeout(() => {
      loadConfig(kind, previewDraft);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [draftPreviewKey, kind, loadConfig]);

  const copyConfig = async (file: ConfigFilePreview) => {
    const text = edits[file.path] ?? file.content;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPath(file.path);
      window.setTimeout(() => {
        setCopiedPath((current) => (current === file.path ? null : current));
      }, 1200);
    } catch {
      // 剪贴板不可用时静默失败，不影响查看。
    }
  };

  const saveConfigFile = async (file: ConfigFilePreview) => {
    const next = edits[file.path];
    if (next === undefined) return;
    setSavingPath(file.path);
    setSaveFailure(null);
    try {
      await configSave(kind, file.path, next);
      // 文件已经改了，把当前生效的 live 配置同步进库，列表才能看到刚配置的 provider。
      const synced = await providers.syncLive(kind);
      if (!synced) {
        throw new Error("配置文件已保存，但 provider 列表同步失败，请重新读取");
      }
      // 直接改原始文件后，当前条目的表单值也要跟着 live 配置走，避免用户
      // 紧接着点「保存 provider」时又把刚改好的 JSON/TOML 覆盖回去。
      const liveGroup = synced.agents.find((item) => item.kind === kind);
      const liveProvider = liveGroup?.providers.find((item) => item.id === liveGroup.currentId);
      if (liveProvider) {
        setDraft(toDraft(liveProvider));
      }
      setConfigFiles(
        (current) =>
          current?.map((item) => (item.path === file.path ? { ...item, content: next } : item)) ??
          null,
      );
      setEdits((current) => {
        const rest = { ...current };
        delete rest[file.path];
        return rest;
      });
      setSavedPath(file.path);
      window.setTimeout(() => {
        setSavedPath((current) => (current === file.path ? null : current));
      }, 1500);
    } catch (error) {
      setSaveFailure(failureLabel(toAppFailure(error)));
    } finally {
      setSavingPath(null);
    }
  };

  const revertConfigFile = (path: string) => {
    setEdits((current) => {
      const rest = { ...current };
      delete rest[path];
      return rest;
    });
    setSaveFailure(null);
  };

  return (
    <>
      <div className="provider-segments" role="tablist">
        {(["claude", "codex"] as const).map((value) => (
          <button
            aria-selected={kind === value}
            className={kind === value ? "is-active" : undefined}
            disabled={draft !== null}
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
        <button
          className="provider-segments__reload"
          disabled={providers.loading || draft !== null}
          onClick={() => void providers.reload()}
          title="重新读取 provider 列表"
          type="button"
        >
          <RefreshCcw aria-hidden="true" size={ICON.xs} />
        </button>
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
            <button className="provider-editor__back" onClick={closeDraft} type="button">
              <ArrowLeft aria-hidden="true" size={ICON.sm} />
              <span>返回 provider 列表</span>
            </button>
            <span className="provider-editor__mode">{draft.id ? "编辑 provider" : "新增 provider"}</span>
          </div>
          <div className="provider-editor__heading">
            <div>
              <p className="provider-editor__eyebrow">{AGENT_LABEL[kind]}</p>
              <h2>{draft.name.trim() || "未命名 provider"}</h2>
            </div>
            <span
              className={`provider-editor__status${
                draft.id !== null && group?.currentId === draft.id ? " is-current" : ""
              }`}
            >
              {draft.id !== null && group?.currentId === draft.id ? "当前使用" : "未启用"}
            </span>
          </div>
          <div className="provider-editor__body">
            <div className="provider-editor__form-column">
              <ProviderForm
                busy={providers.loading}
                draft={draft}
                issue={issue}
                onCancel={closeDraft}
                onChange={(next) => {
                  setDraft(next);
                  setFormNotice(null);
                }}
                onSubmit={submit}
              />
              {formNotice ? <p className="provider-notice">{formNotice}</p> : null}
            </div>
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
          </div>
        </div>
      ) : (
        <>
          {providers.loading && providers.catalog === null ? (
            <p className="provider-hint">正在读取 provider…</p>
          ) : (
            <>
              <div className="provider-list">
                <ProviderRow
                  active={group?.currentId == null}
                  busy={providers.loading}
                  label="官方端点"
                  onSelect={() => void providers.select(kind, null)}
                  subtitle="使用 CLI 自己的登录态"
                />
                {providers.catalog !== null && group === undefined ? (
                  <p className="provider-hint">
                    没有读到 {AGENT_LABEL[kind]} 的 provider 数据，点上方刷新重试。
                  </p>
                ) : null}
                {list.map((config) => (
                  <ProviderRow
                    active={group?.currentId === config.id}
                    busy={providers.loading}
                    key={config.id}
                    label={config.name}
                    onEdit={() => openDraft(toDraft(config))}
                    onRemove={() => setPendingRemove(config)}
                    onSelect={() => void providers.select(kind, config.id)}
                    subtitle={`${hostOf(config.baseUrl)} · ${maskKey(config.apiKey)}`}
                  />
                ))}
              </div>

              <button
                className="provider-add"
                onClick={() => {
                  openDraft({ ...EMPTY_DRAFT });
                }}
                type="button"
              >
                <Plus aria-hidden="true" size={ICON.sm} />
                <span>新增 provider</span>
              </button>
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
            void providers.remove(kind, pendingRemove.id);
            setPendingRemove(null);
          }}
        />
      ) : null}
    </>
  );
}

interface ProviderRowProps {
  active: boolean;
  busy: boolean;
  label: string;
  onEdit?: () => void;
  onRemove?: () => void;
  onSelect: () => void;
  subtitle: string;
}

function ProviderRow({ active, busy, label, onEdit, onRemove, onSelect, subtitle }: ProviderRowProps) {
  return (
    <div className={`provider-row${active ? " is-active" : ""}`}>
      <button className="provider-row__main" disabled={busy} onClick={onSelect} type="button">
        <span className="provider-row__text">
          <strong>{label}</strong>
          <small>{subtitle}</small>
        </span>
      </button>
      <span className="provider-row__tail">
        {active ? <Check aria-hidden="true" className="provider-row__check" size={ICON.sm} /> : null}
        {onEdit ? (
          <button className="provider-row__act" onClick={onEdit} title={`编辑 ${label}`} type="button">
            <Pencil aria-hidden="true" size={ICON.xs} />
          </button>
        ) : null}
      </span>
      <span className="provider-row__tail">
        {onRemove ? (
          <button
            className="provider-row__act provider-row__act--danger"
            onClick={onRemove}
            title={`删除 ${label}`}
            type="button"
          >
            <Trash2 aria-hidden="true" size={ICON.xs} />
          </button>
        ) : null}
      </span>
    </div>
  );
}

function RemoveConfirm({
  config,
  isCurrent,
  onCancel,
  onConfirm,
}: {
  config: ProviderConfig;
  isCurrent: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useDismiss<HTMLDivElement>(true, onCancel);
  return (
    <div className="modal-scrim provider-confirm">
      <div aria-modal="true" className="modal" ref={ref} role="dialog">
        <strong className="modal__title">删除 {config.name}？</strong>
        <p className="modal__body">
          {isCurrent
            ? "它正在生效，删除后会先切回官方端点。API Key 一并删掉，撤不回来。"
            : "API Key 会一并删掉，撤不回来。"}
        </p>
        <div className="modal__actions">
          <button onClick={onCancel} type="button">取消</button>
          <button className="modal__danger" onClick={onConfirm} type="button">删除</button>
        </div>
      </div>
    </div>
  );
}

/** 列表里只显示主机名：完整 URL 太长会把这一行挤没。 */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
