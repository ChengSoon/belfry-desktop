import { AlertTriangle, Check, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { AgentKind } from "../../workspace/contracts";
import { failureLabel } from "../../workspace/errors";
import { useDismiss } from "../../workspace/useDismiss";
import {
  AGENT_LABEL,
  EMPTY_DRAFT,
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

  // 表单填到一半时，一次误点框外就把输入全丢了，所以让外壳先别响应退出手势。
  useEffect(() => {
    onGuardChange(draft !== null);
    return () => onGuardChange(false);
  }, [draft, onGuardChange]);

  const group = providers.catalog?.agents.find((item) => item.kind === kind);
  const list = useMemo(() => group?.providers ?? [], [group]);
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
          <div className="provider-list">
            <ProviderRow
              active={group?.currentId == null}
              busy={providers.loading}
              label="官方端点"
              onSelect={() => void providers.select(kind, null)}
              subtitle="使用 CLI 自己的登录态"
            />
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
