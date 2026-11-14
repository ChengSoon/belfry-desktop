import { t, useTranslation } from "../../i18n";
import { RefreshCw } from "lucide-react";
import { Fragment, useEffect } from "react";
import { SButton, SGroupTitle, SList } from "../../settings/kit";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { useHookSettings } from "./useHookSettings";
import { ICON } from "../../theme/sizing";
import { usesTerminalStatus } from "../contracts";
import "./hooks.css";

export function HookSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  useTranslation();
  const state = useHookSettings();
  useEffect(() => {
    onGuardChange(state.busy || Boolean(state.preview));
    return () => onGuardChange(false);
  }, [state.busy, state.preview, onGuardChange]);
  const connected = state.reports.filter((report) => report.installed > 0 && !usesTerminalStatus(report.kind)).length;
  // 布局按 docs/design/belfry-ui/settings-v3/settings.html?page=sessions（T42）：
  // 「Agent Hook · n 个 Agent · m 个已连接」列表（预览在对应行下方就地展开）→ 后台任务列表。
  return <div className="hook-settings">
    <SGroupTitle tail={<>
      {state.reports.length ? <span>{t("agent.HookSettingsSection.agentsMeta", { count: state.reports.length, connected })}</span> : null}
      <SButton aria-label={t("agent.HookSettingsSection.text_60b5ef502d")} disabled={state.busy || Boolean(state.preview)} icon onClick={state.reload} title={t("agent.HookSettingsSection.text_60b5ef502d")}><RefreshCw size={ICON.sm} /></SButton>
    </>}>{t("agent.HookSettingsSection.statusTitle")}</SGroupTitle>
    {state.error ? <p className="sk-note is-danger hook-error" role="alert">{state.error}</p> : null}
    <SList label={t("agent.HookSettingsSection.statusTitle")}>
      {state.reports.length === 0 && state.busy ? <p className="sk-empty" role="status">{t("agent.HookSettingsSection.text_b59e11933d")}</p> : null}
      {state.reports.map((report) => <Fragment key={report.kind}>
        <HookAgentCard report={report} busy={state.busy || Boolean(state.preview)} onPreview={state.inspect} />
        {state.preview?.kind === report.kind ? <HookPreviewCard preview={state.preview} busy={state.busy} onCancel={state.cancel} onConfirm={state.confirm} /> : null}
      </Fragment>)}
    </SList>
    <p className="sk-lede hook-settings__footnote">{t("agent.HookSettingsSection.protocolNote")}</p>
  </div>;
}
