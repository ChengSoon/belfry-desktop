import { Disclosure } from "../../components/controls/Disclosure";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { SettingsHeader } from "../../settings/SettingsHeader";
import { HookAgentCard, HookPreviewCard } from "./HookCards";
import { useHookSettings } from "./useHookSettings";
import { ICON } from "../../theme/sizing";
import "./hooks.css";

export function HookSettingsSection({ onGuardChange }: { onGuardChange: (guarded: boolean) => void }) {
  const state = useHookSettings();
  useEffect(() => {
    onGuardChange(state.busy || Boolean(state.preview));
    return () => onGuardChange(false);
  }, [state.busy, state.preview, onGuardChange]);
  return <section className="hook-settings" aria-label="会话状态设置">
    <SettingsHeader
      actions={<button className="icon-button" disabled={state.busy || Boolean(state.preview)} onClick={state.reload} title="刷新 Hook 状态" type="button"><RefreshCw size={ICON.md} /></button>}
      description="直接接收 CLI 事件，让等待、完成和失败更清楚。"
      title="会话状态"
    />
    <p className="hook-settings__intro">未连接时，终端会标注“屏幕推断”。Hook 只影响此后启动的本地 Agent 会话；Shell 和 SSH 保持原有行为。</p>
    {state.error ? <p className="hook-error" role="alert">{state.error}</p> : null}
    {state.preview ? <HookPreviewCard preview={state.preview} busy={state.busy} onCancel={state.cancel} onConfirm={state.confirm} /> : null}
    {state.reports.length === 0 && state.busy ? <p role="status">正在检查 CLI 版本和 Hook 配置…</p> : null}
    {state.reports.map((report) => <HookAgentCard key={report.kind} report={report} busy={state.busy || Boolean(state.preview)} onPreview={state.inspect} />)}
    <Disclosure className="hook-settings__footnote" title={<>版本与配置说明</>}><p>支持下限：Codex 0.154.0、Claude Code 2.1.201。较旧或无法识别的版本保持推断。安装内容可预览，移除只处理 Belfry 托管命令。</p></Disclosure>
  </section>;
}
