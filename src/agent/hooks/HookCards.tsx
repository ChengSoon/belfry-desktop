import { Disclosure } from "../../components/controls/Disclosure";
import type { AgentKind } from "../contracts";
import type { AgentHookReport, HookInstallPreview } from "./contracts";

interface AgentProps {
  report: AgentHookReport; busy: boolean;
  onPreview: (kind: AgentKind, enabled: boolean) => void;
}
interface PreviewProps { preview: HookInstallPreview; busy: boolean; onConfirm: () => void; onCancel: () => void }

const label = (kind: AgentKind) => kind === "codex" ? "Codex" : kind === "claude" ? "Claude Code" : "Pi";

export function HookAgentCard({ report, busy, onPreview }: AgentProps) {
  const name = label(report.kind);
  return (
    <article className="hook-agent-card" aria-label={`${name} Hook 设置`}>
      <header><strong>{name}</strong><span>{report.version ?? "未检测到 CLI"}</span></header>
      <div className="hook-agent-card__summary">
        <span>{report.supported ? "可启用 Hook" : "使用屏幕推断"}</span>
        <span>已安装 {report.installed}/{report.expected} 个事件</span>
      </div>
      <p>{report.note}</p>
      {report.configPath ? <Disclosure className="hook-config-details" title={<>配置位置</>}><code className="hook-config-path">{report.configPath}</code></Disclosure> : null}
      {report.error ? <p className="hook-error" role="alert">{report.error}</p> : null}
      <footer>
        <button disabled={busy || !report.supported || Boolean(report.error)} onClick={() => onPreview(report.kind, true)} type="button">预览启用 {name} Hook</button>
        {report.installed > 0 ? <button disabled={busy} onClick={() => onPreview(report.kind, false)} type="button">预览移除 {name} Hook</button> : null}
      </footer>
    </article>
  );
}

export function HookPreviewCard({ preview, busy, onConfirm, onCancel }: PreviewProps) {
  return (
    <section className="hook-preview" aria-label="Hook 变更预览">
      <strong>{preview.enabling ? "启用" : "移除"} {label(preview.kind)} Hook</strong>
      <code className="hook-config-path">{preview.configPath}</code>
      <p>{preview.enabling ? "添加或更新下列事件；其他 Hook 和配置保持原有内容。" : `仅移除 ${preview.managedBefore} 个 Belfry 托管 Hook，保留其他命令。`}</p>
      <div className="hook-event-list">{preview.events.map((event) => <code key={event}>{event}</code>)}</div>
      {preview.command ? <pre>{preview.command}</pre> : null}
      {preview.enabling && preview.kind === "codex" ? <p>启用后请重开会话，在 Codex 的 <code>/hooks</code> 中审阅并信任。Belfry 不改写信任记录。</p> : null}
      <p>只接收会话状态，不代替你批准工具调用。移除后请重开会话。</p>
      <footer>
        <button disabled={busy} onClick={onCancel} type="button">取消</button>
        <button className="hook-primary" disabled={busy} onClick={onConfirm} type="button">{busy ? "正在保存…" : preview.enabling ? "确认启用" : "确认移除"}</button>
      </footer>
    </section>
  );
}
