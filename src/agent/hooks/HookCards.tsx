import { t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { AGENT_ICONS } from "../../workspace/components/AgentIcons";
import { ICON } from "../../theme/sizing";
import { AGENT_METADATA, type AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";

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
  const status = hookStatus(report);
  // 已全部连接且无过期事件时只给「预览移除」（稿）；检测到 CLI 但不支持 / 出错时保留禁用的「预览启用」，说明此处不能启用。
  const complete = report.installed >= report.expected && report.stale === 0;
  const showEnable = Boolean(report.version) && !(report.supported && !report.error && complete);
  const canEnable = report.supported && !report.error;
  return (
    <article className="os-row with-agent hook-agent-card" aria-label={t("agent.HookCards.text_03343237f2", { name })}>
      <span className={`os-agent${report.kind === "claude" ? " claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
      <div className="os-row__body">
        <div className="os-row__label">{name}<span className={`os-tag ${status.tone}`.trim()}>{status.text}</span></div>
        <div className="os-row__sub hook-agent-card__summary">
          {report.version ? <span>{t("agent.HookCards.text_512aa19391", { installed: report.installed, expected: report.expected })}</span> : null}
          {report.version ? <span className="os-mono">{report.version}</span> : null}
        </div>
        {report.note ? <p className="os-row__hint">{report.note}</p> : null}
        {report.configPath ? <Disclosure className="hook-config-details" title={<>{t("agent.HookCards.text_cec9ecbbac")}</>}><code className="os-paths hook-config-path">{report.configPath}</code></Disclosure> : null}
        {report.error ? <p className="hook-error" role="alert">{report.error}</p> : null}
      </div>
      <div className="os-trail">
        {showEnable ? <button aria-label={t("agent.HookCards.text_5c7e011e40", { name })} className="os-btn secondary" disabled={busy || !canEnable} onClick={() => onPreview(report.kind, true)} type="button">{t("agent.HookCards.previewEnable")}</button> : null}
        {report.installed > 0 ? <button aria-label={t("agent.HookCards.text_c493b52c8b", { name })} className="os-btn danger-ghost" disabled={busy} onClick={() => onPreview(report.kind, false)} type="button">{t("agent.HookCards.previewRemove")}</button> : null}
      </div>
    </article>
  );
}

export function HookPreviewCard({ preview, busy, onConfirm, onCancel }: PreviewProps) {
  useTranslation();
  return (
    <section className="hook-preview" aria-label={t("agent.HookCards.text_b914b0c6b7")}>
      <strong>{t(preview.enabling ? "agent.HookCards.enableTitle" : "agent.HookCards.removeTitle", { agent: label(preview.kind) })}</strong>
      <code className="os-paths hook-config-path">{preview.configPath}</code>
      <p>{preview.enabling ? t("agent.HookCards.text_9be6b0e2c7") : t("agent.HookCards.text_cd6b3e906e", { count: preview.managedBefore })}</p>
      <div className="hook-event-list">{preview.events.map((event) => <code key={event}>{event}</code>)}</div>
      {preview.command ? <pre>{preview.command}</pre> : null}
      {preview.enabling && preview.kind === "codex" ? <p>{t("agent.HookCards.codexTrust", { command: "/hooks" })}</p> : null}
      <p>{t("agent.HookCards.text_3b6466d441")}</p>
      <footer className="os-actions">
        <button className="os-btn" disabled={busy} onClick={onCancel} type="button">{t("agent.HookCards.text_2cd0f3be87")}</button>
        <button className={`os-btn ${preview.enabling ? "primary" : "danger"} hook-primary`} disabled={busy} onClick={onConfirm} type="button">{busy ? t("agent.HookCards.text_6bdb443509") : preview.enabling ? t("agent.HookCards.text_e08a9527e8") : t("agent.HookCards.text_ee7dea070d")}</button>
      </footer>
    </section>
  );
}
