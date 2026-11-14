import { t, useTranslation } from "../../i18n";
import { Notice } from "../../components/Notice";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { useHookSettings } from "./useHookSettings";
import { ICON } from "../../theme/sizing";
import { usesTerminalStatus } from "../contracts";
import "../../settings/obsidianSections.css";
import "./hooks.css";

export function HookSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  useTranslation();
  const state = useHookSettings();
  useEffect(() => {
    onGuardChange(state.busy || Boolean(state.preview));
    return () => onGuardChange(false);
  }, [state.busy, state.preview, onGuardChange]);
  const connected = state.reports.filter((report) => report.installed > 0 && !usesTerminalStatus(report.kind)).length;
  return <section className="hook-settings os-page" aria-label={t("agent.HookSettingsSection.text_917c907a21")}>
    <SettingsHeader
      actions={<button aria-label={t("agent.HookSettingsSection.text_60b5ef502d")} className="os-btn icon" disabled={state.busy || Boolean(state.preview)} onClick={state.reload} title={t("agent.HookSettingsSection.text_60b5ef502d")} type="button"><RefreshCw size={ICON.sm} /></button>}
      description={t("agent.HookSettingsSection.text_688418bd24")}
      title={t("agent.HookSettingsSection.text_ea5e729632")}
    />
    <Notice className="hook-settings__intro" tone="info">{t("agent.HookSettingsSection.protocolNote")}</Notice>
    {state.error ? <Notice className="hook-error" role="alert">{state.error}</Notice> : null}
    {state.preview ? <HookPreviewCard preview={state.preview} busy={state.busy} onCancel={state.cancel} onConfirm={state.confirm} /> : null}
    <section className="os-section">
      <div className="os-group-head"><h3>{t("agent.HookSettingsSection.statusTitle")}</h3>
        {state.reports.length ? <span className="os-meta">{t("agent.HookSettingsSection.agentsMeta", { count: state.reports.length, connected })}</span> : null}</div>
      <div className="os-group">
        {state.reports.length === 0 && state.busy ? <p className="os-empty" role="status">{t("agent.HookSettingsSection.text_b59e11933d")}</p> : null}
        {state.reports.map((report) => <HookAgentCard key={report.kind} report={report} busy={state.busy || Boolean(state.preview)} onPreview={state.inspect} />)}
      </div>
      <p className="hook-settings__footnote">{t("agent.HookSettingsSection.text_a463dbcbe3")}</p>
    </section>
  </section>;
}
