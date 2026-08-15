import { AlertTriangle, Check, Pencil, Plus, RefreshCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
  /** 正在编辑的文件原文，按 agent 分开存：切走再切回，编辑内容不丢。
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

  // 临时排查用：把 WKWebView 里的真实布局报出去，排完就删。
  // headless Chrome 里列表渲染正常，所以要看的是 App 自己的渲染引擎量出了什么。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = document.querySelector(".provider-list");
      const rows = [...document.querySelectorAll(".provider-row")];
      const cs = el ? getComputedStyle(el) : null;
      void fetch("http://127.0.0.1:8899/", {
        body: JSON.stringify({
          stage: "layout",
          kind,
          listCount: list.length,
          listExists: !!el,
          listRect: el?.getBoundingClientRect(),
          listStyle: cs && {
            display: cs.display,
            maxHeight: cs.maxHeight,
            overflowY: cs.overflowY,
            height: cs.height,
            minHeight: cs.minHeight,
          },
          parentStyle: (() => {
            const p = el?.parentElement;
            const pcs = p ? getComputedStyle(p) : null;
            return pcs && { cls: p?.className, display: pcs.display, alignContent: pcs.alignContent, height: pcs.height };
          })(),
          rows: rows.map((r) => ({
            label: r.querySelector("strong")?.textContent,
            rect: r.getBoundingClientRect(),
          })),
          ua: navigator.userAgent,
        }),
        method: "POST",
      }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [kind, list]);
  const conflicts = useMemo(
    () => providers.catalog?.envConflicts.filter((item) => item.kind === kind) ?? [],
    [kind, providers.catalog],
  );

  const submit = () => {
    if (!draft) return;
    const found = validateDraft(draft, list);
    setIssue(found);
    if (found) return;
    void providers.save(kind, draft).then(() => setDraft(null));
  };

  const loadConfig = (agentKind: AgentKind) => {
    setConfigLoading(true);
    setConfigFailure(null);
    configPreview(agentKind)
      .then((files) => setConfigFiles(files))
      .catch((error) => setConfigFailure(failureLabel(toAppFailure(error))))
      .finally(() => setConfigLoading(false));
  };

  // 配置文件原文跟着当前 agent 走。切换时先清掉旧数据，并用 cleanup 把
  // 上一个 agent 的慢请求标记为失效，避免它回来盖掉新 agent 的内容。
  useEffect(() => {
    setConfigFiles(null);
    setSaveFailure(null);
    let cancelled = false;
    setConfigLoading(true);
    setConfigFailure(null);
    configPreview(kind)
      .then((files) => {
        if (!cancelled) setConfigFiles(files);
      })
      .catch((error) => {
        if (!cancelled) setConfigFailure(failureLabel(toAppFailure(error)));
      })
      .finally(() => {
        if (!cancelled) setConfigLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [kind]);

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
      await providers.syncLive(kind);
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
          disabled={providers.loading}
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
        <ProviderForm
          busy={providers.loading}
          draft={draft}
          issue={issue}
          onCancel={() => {
            setDraft(null);
            setIssue(null);
          }}
          onChange={setDraft}
          onSubmit={submit}
        />
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
                    onEdit={() => {
                      // 上一次切换的提示留在表单下方会看成是这次编辑的结果。
                      providers.dismissNotice();
                      setIssue(null);
                      setDraft(toDraft(config));
                    }}
                    onRemove={() => setPendingRemove(config)}
                    onSelect={() => void providers.select(kind, config.id)}
                    subtitle={`${hostOf(config.baseUrl)} · ${maskKey(config.apiKey)}`}
                  />
                ))}
              </div>

              <button
                className="provider-add"
                onClick={() => {
                  providers.dismissNotice();
                  setIssue(null);
                  setDraft({ ...EMPTY_DRAFT });
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

      <section aria-label="当前配置文件" className="provider-config">
        <header className="provider-config__head">
          <h3>当前配置文件</h3>
          <button
            className="provider-config__reload"
            disabled={configLoading || hasDirty}
            onClick={() => loadConfig(kind)}
            title={hasDirty ? "有未保存的修改，先保存或还原" : "重新读取"}
            type="button"
          >
            <RefreshCcw aria-hidden="true" size={ICON.xs} />
          </button>
        </header>
        <p className="provider-config__hint">
          {AGENT_LABEL[kind]} 配置文件的完整内容（含密钥，仅保存在本机）。
          Belfry 只认领 provider 路由那几个字段，其余内容原样保留。可直接编辑保存，
          保存前会校验 JSON/TOML，改坏了不会落盘。
        </p>
        {configFailure ? (
          <p className="provider-error" role="alert">{configFailure}</p>
        ) : null}
        {saveFailure ? (
          <p className="provider-error" role="alert">{saveFailure}</p>
        ) : null}
        {configLoading && configFiles === null ? (
          <p className="provider-config__hint">正在读取…</p>
        ) : null}
        {configFiles && configFiles.length === 0 ? (
          <p className="provider-config__hint">还没有配置文件。</p>
        ) : null}
        {configFiles?.map((file) => (
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
                    onClick={() => void saveConfigFile(file)}
                    type="button"
                  >
                    {savingPath === file.path ? "保存中…" : "保存"}
                  </button>
                  <button
                    className="provider-config__copy"
                    disabled={savingPath === file.path}
                    onClick={() => revertConfigFile(file.path)}
                    type="button"
                  >
                    还原
                  </button>
                </>
              ) : null}
              <button
                className="provider-config__copy"
                onClick={() => void copyConfig(file)}
                type="button"
              >
                {copiedPath === file.path ? "已复制" : "复制"}
              </button>
              {savedPath === file.path ? (
                <span className="provider-config__saved">已保存</span>
              ) : null}
            </div>
            {file.content.trim() || edits[file.path] !== undefined ? (
              <textarea
                aria-label={`编辑 ${file.path}`}
                className="provider-config__editor"
                disabled={savingPath === file.path}
                onChange={(event) =>
                  setEdits((current) => ({ ...current, [file.path]: event.target.value }))
                }
                spellCheck={false}
                value={edits[file.path] ?? file.content}
              />
            ) : (
              <p className="provider-config__empty">文件还不存在</p>
            )}
          </div>
        ))}
      </section>

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
