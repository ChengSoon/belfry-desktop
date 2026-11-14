import { t, useTranslation } from "../../i18n";
import { AGENT_ICONS } from "../../workspace/components/AgentIcons";
import { ICON } from "../../theme/sizing";
import { AGENT_METADATA, usesTerminalStatus, type AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";
import { SButton, STag } from "../../settings/kit";

interface AgentProps {
  report: AgentHookReport; busy: boolean;
  onPreview: (kind: AgentKind, enabled: boolean) => void;
}
interface PreviewProps { preview: HookInstallPreview; busy: boolean; onConfirm: () => void; onCancel: () => void }

const label = (kind: AgentKind) => AGENT_METADATA[kind].name;

/** 状态徽标：未检测到 CLI / 屏幕推断 / 已连接 / 可启用。 */
function hookStatus(report: AgentHookReport): { tone: string; text: string } {
  if (!report.version) return { tone: "", text: t("agent.HookCards.text_29e9fb477a") };
  if (!report.supported) return { tone: "", text: t("agent.HookCards.text_ef38a253dc") };
  if (report.installed > 0) return { tone: "ok", text: t("agent.HookCards.connected") };
  return { tone: "accent", text: t("agent.HookCards.text_142b2f5cfa") };
}

/** 曜石稿（T19 hooks）：每个 Agent 是 group 内一行，图标块 + 名称/徽标 + 事件数·版本 + 配置位置，动作在行尾。 */
export function HookAgentCard({ report, busy, onPreview }: AgentProps) {
  useTranslation();
  const name = label(report.kind);
  const Icon = AGENT_ICONS[report.kind];
  const protocol = usesTerminalStatus(report.kind);
  if (protocol) return <article className="sk-item hook-agent-card" aria-label={t("agent.HookCards.protocolLabel", { name })}>
    <span className={`sk-ic${report.kind === "claude" ? " is-claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
    <div className="sk-l">
      <b>{name}{report.version ? <span className="sk-pill">{report.version}</span> : null}</b>
      <span>{t(report.version ? "agent.HookCards.protocolHint" : "agent.HookCards.hintMissing")}</span>
      {report.installed > 0 ? <span>{t("agent.HookCards.legacyHooksHint")}</span> : null}
    </div>
    <div className="sk-r">
      <STag>{t("agent.HookCards.protocolStatus")}</STag>
      {report.installed > 0 ? <SButton aria-label={t("agent.HookCards.text_c493b52c8b", { name })} disabled={busy}
        onClick={() => onPreview(report.kind, false)}>{t("agent.HookCards.previewRemove")}</SButton> : null}
    </div>
  </article>;
  const status = hookStatus(report);
  // 已全部连接且无过期事件时只给「预览移除」（稿）；检测到 CLI 但不支持 / 出错时保留禁用的「预览启用」，说明此处不能启用。
  const complete = report.installed >= report.expected && report.stale === 0;
  const showEnable = Boolean(report.version) && !(report.supported && !report.error && complete);
  const canEnable = report.supported && !report.error;
  const hint = !report.version ? t("agent.HookCards.hintMissing")
    : !report.supported ? t("agent.HookCards.hintScreen")
      : report.installed > 0 ? t("agent.HookCards.hintConnected", { installed: report.installed, expected: report.expected })
        : t("agent.HookCards.hintAvailable");
  return (
    <article className="sk-item hook-agent-card" aria-label={t("agent.HookCards.text_03343237f2", { name })}>
      <span className={`sk-ic${report.kind === "claude" ? " is-claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
      <div className="sk-l">
        <b>{name}{report.version ? <span className="sk-pill">{report.version}</span> : null}</b>
        <span title={[report.note, report.configPath].filter(Boolean).join("\n") || undefined}>{hint}</span>
        {report.error ? <span className="hook-error" role="alert">{report.error}</span> : null}
      </div>
      <div className="sk-r">
        <STag tone={status.tone === "ok" ? "ok" : status.tone === "accent" ? "accent" : undefined} dot={status.tone === "ok"}>{status.text}</STag>
        {showEnable ? <SButton aria-label={t("agent.HookCards.text_5c7e011e40", { name })} disabled={busy || !canEnable} onClick={() => onPreview(report.kind, true)} tone="secondary">{t("agent.HookCards.previewEnable")}</SButton> : null}
        {report.installed > 0 ? <SButton aria-label={t("agent.HookCards.text_c493b52c8b", { name })} disabled={busy} onClick={() => onPreview(report.kind, false)}>{t("agent.HookCards.previewRemove")}</SButton> : null}
      </div>
    </article>
  );
}

/** 变更预览：在对应 Agent 行下方就地展开（稿：事件清单 + 配置路径 + 取消 / 确认）。 */
export function HookPreviewCard({ preview, busy, onConfirm, onCancel }: PreviewProps) {
  useTranslation();
  return (
    <section className="sk-panel hook-preview" aria-label={t("agent.HookCards.text_b914b0c6b7")}>
      <h4>{t(preview.enabling ? "agent.HookCards.enableTitle" : "agent.HookCards.removeTitle", { agent: label(preview.kind) })}</h4>
      <p>{preview.enabling ? t("agent.HookCards.text_9be6b0e2c7") : t("agent.HookCards.text_cd6b3e906e", { count: preview.managedBefore })} {t("agent.HookCards.text_3b6466d441")}</p>
      <ul className="hook-event-list">{preview.events.map((event) => <li key={event}>{event}</li>)}</ul>
      <div className="sk-code hook-config-path">{preview.configPath}</div>
      {preview.command ? <pre className="sk-code">{preview.command}</pre> : null}
      {preview.enabling && preview.kind === "codex" ? <p>{t("agent.HookCards.codexTrust", { command: "/hooks" })}</p> : null}
      <div className="sk-acts">
        <SButton disabled={busy} onClick={onCancel}>{t("agent.HookCards.text_2cd0f3be87")}</SButton>
        <SButton className="hook-primary" disabled={busy} onClick={onConfirm} tone={preview.enabling ? "primary" : "danger"}>{busy ? t("agent.HookCards.text_6bdb443509") : preview.enabling ? t("agent.HookCards.text_e08a9527e8") : t("agent.HookCards.text_ee7dea070d")}</SButton>
      </div>
    </section>
  );
}
