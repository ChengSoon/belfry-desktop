import { t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { AGENT_METADATA, type AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";

interface AgentProps {
  report: AgentHookReport; busy: boolean;
  onPreview: (kind: AgentKind, enabled: boolean) => void;
}
interface PreviewProps { preview: HookInstallPreview; busy: boolean; onConfirm: () => void; onCancel: () => void }

const label = (kind: AgentKind) => AGENT_METADATA[kind].name;

export function HookAgentCard({ report, busy, onPreview }: AgentProps) {
  useTranslation();
  const name = label(report.kind);
  return (
    <article className="hook-agent-card" aria-label={t("agent.HookCards.text_03343237f2", { name: name })}>
      <header><strong>{name}</strong><span>{report.version ?? t("agent.HookCards.text_29e9fb477a")}</span></header>
      <div className="hook-agent-card__summary">
        <span>{report.supported ? t("agent.HookCards.text_142b2f5cfa") : t("agent.HookCards.text_ef38a253dc")}</span>
        <span>{t("agent.HookCards.text_512aa19391", { installed: report.installed, expected: report.expected })}</span>
      </div>
      <p>{report.note}</p>
      {report.configPath ? <Disclosure className="hook-config-details" title={<>{t("agent.HookCards.text_cec9ecbbac")}</>}><code className="hook-config-path">{report.configPath}</code></Disclosure> : null}
      {report.error ? <p className="hook-error" role="alert">{report.error}</p> : null}
      <footer>
        <button disabled={busy || !report.supported || Boolean(report.error)} onClick={() => onPreview(report.kind, true)} type="button">{t("agent.HookCards.text_5c7e011e40", { name: name })}</button>
        {report.installed > 0 ? <button disabled={busy} onClick={() => onPreview(report.kind, false)} type="button">{t("agent.HookCards.text_c493b52c8b", { name: name })}</button> : null}
      </footer>
    </article>
  );
}

export function HookPreviewCard({ preview, busy, onConfirm, onCancel }: PreviewProps) {
  useTranslation();
  return (
    <section className="hook-preview" aria-label={t("agent.HookCards.text_b914b0c6b7")}>
      <strong>{t(preview.enabling ? "agent.HookCards.enableTitle" : "agent.HookCards.removeTitle", { agent: label(preview.kind) })}</strong>
      <code className="hook-config-path">{preview.configPath}</code>
      <p>{preview.enabling ? t("agent.HookCards.text_9be6b0e2c7") : t("agent.HookCards.text_cd6b3e906e", { count: preview.managedBefore })}</p>
      <div className="hook-event-list">{preview.events.map((event) => <code key={event}>{event}</code>)}</div>
      {preview.command ? <pre>{preview.command}</pre> : null}
      {preview.enabling && preview.kind === "codex" ? <p>{t("agent.HookCards.codexTrust", { command: "/hooks" })}</p> : null}
      <p>{t("agent.HookCards.text_3b6466d441")}</p>
      <footer>
        <button disabled={busy} onClick={onCancel} type="button">{t("agent.HookCards.text_2cd0f3be87")}</button>
        <button className="hook-primary" disabled={busy} onClick={onConfirm} type="button">{busy ? t("agent.HookCards.text_6bdb443509") : preview.enabling ? t("agent.HookCards.text_e08a9527e8") : t("agent.HookCards.text_ee7dea070d")}</button>
      </footer>
    </section>
  );
}
