import { AlertTriangle, Gauge, RefreshCcw, X } from "lucide-react";
import type { CSSProperties } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { USAGE_WINDOWS } from "../contracts";
import { UsageInsights } from "../insights/UsageInsights";
import { useUsageInsights } from "../insights/useUsageInsights";
import { USAGE_WIDTH } from "../usageWidth";
import "../usage.css";
import { Checkbox } from "../../components/controls/Checkbox";

interface UsagePanelProps { project: ProjectWorkspace | null; onClose: () => void }

export function UsagePanel({ project, onClose }: UsagePanelProps) {
  const usage = useUsageInsights(project?.rootPath ?? null);
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(USAGE_WIDTH);
  const panelStyle = { "--usage-width": width + "px" } as CSSProperties;
  return (
    <section className="usage-panel" aria-label="额度用量" style={panelStyle}>
      <header className="usage-head">
        <Gauge aria-hidden="true" size={ICON.md} /><h2>用量</h2>
        <button className="icon-button icon-button--sm" disabled={usage.loading}
          onClick={() => void usage.reload()} title="刷新用量" aria-label="刷新用量" type="button">
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title="关闭用量" aria-label="关闭用量" type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>
      <div className="usage-filters">
        <div className="usage-segments" role="group" aria-label="统计窗口">
          {USAGE_WINDOWS.map((option) => <button aria-pressed={usage.windowDays === option.days}
            className={usage.windowDays === option.days ? "is-active" : undefined} key={option.label}
            onClick={() => usage.setWindowDays(option.days)} type="button">{option.label}</button>)}
        </div>
        {usage.canScope ? <label className="usage-scope" title={project?.rootPath}>
          <Checkbox checked={usage.scoped} onChange={usage.setScoped} ariaLabel={`只看 ${project?.name}`} />
          <span>只看 {project?.name}</span>
        </label> : null}
      </div>
      {usage.error ? <p className="usage-error" role="alert"><AlertTriangle aria-hidden="true" size={ICON.sm} />{usage.error}</p> : null}
      <div className="usage-body" aria-busy={usage.loading}>
        {usage.report ? <UsageInsights report={usage.report} project={project} /> : null}
        {usage.loading ? <p className="usage-hint" role="status">正在扫描会话日志…</p> : null}
      </div>
      <PanelResizeHandle label="调整用量面板宽度" onCommit={commitWidth} onReset={resetWidth}
        onResize={setWidth} spec={USAGE_WIDTH} width={width} />
    </section>
  );
}
