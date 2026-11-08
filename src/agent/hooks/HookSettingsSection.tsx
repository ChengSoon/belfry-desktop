import { t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { useHookSettings } from "./useHookSettings";
import { ICON } from "../../theme/sizing";
import "./hooks.css";

export function HookSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  useTranslation();
  const state = useHookSettings();
  useEffect(() => {
    onGuardChange(state.busy || Boolean(state.preview));
    return () => onGuardChange(false);
  }, [state.busy, state.preview, onGuardChange]);
  return <section className="hook-settings" aria-label={t("agent.HookSettingsSection.text_917c907a21")}>
    <SettingsHeader
      actions={<button className="icon-button" disabled={state.busy || Boolean(state.preview)} onClick={state.reload} title={t("agent.HookSettingsSection.text_60b5ef502d")} type="button"><RefreshCw size={ICON.md} /></button>}
      description={t("agent.HookSettingsSection.text_688418bd24")}
      title={t("agent.HookSettingsSection.text_ea5e729632")}
    />
    <p className="hook-settings__intro">{t("agent.HookSettingsSection.text_eb69e31885")}</p>
    {state.error ? <p className="hook-error" role="alert">{state.error}</p> : null}
    {state.preview ? <HookPreviewCard preview={state.preview} busy={state.busy} onCancel={state.cancel} onConfirm={state.confirm} /> : null}
    {state.reports.length === 0 && state.busy ? <p role="status">{t("agent.HookSettingsSection.text_b59e11933d")}</p> : null}
    {state.reports.map((report) => <HookAgentCard key={report.kind} report={report} busy={state.busy || Boolean(state.preview)} onPreview={state.inspect} />)}
    <Disclosure className="hook-settings__footnote" title={<>{t("agent.HookSettingsSection.text_ee9afa5b23")}</>}><p>{t("agent.HookSettingsSection.text_a463dbcbe3")}</p></Disclosure>
  </section>;
}
