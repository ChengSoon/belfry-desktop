import { AlertTriangle, Gauge, RefreshCcw, X } from "lucide-react";
import type { CSSProperties } from "react";
import { PanelResizeHandle } from "../../panel/PanelResizeHandle";
import { usePanelWidth } from "../../panel/usePanelWidth";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { failureLabel } from "../../workspace/errors";
import { USAGE_WINDOWS, type ModelUsage, type UsageReport } from "../contracts";
import { agentLabel, formatExact, formatRelative, formatTokens, totalTokens } from "../format";
import { useUsageReport } from "../useUsageReport";
import { USAGE_WIDTH } from "../usageWidth";
import { QuotaBar } from "./QuotaBar";
import "../usage.css";

interface UsagePanelProps {
  project: ProjectWorkspace | null;
  onClose: () => void;
}

export function UsagePanel({ project, onClose }: UsagePanelProps) {
  const usage = useUsageReport({ enabled: true, projectRoot: project?.rootPath ?? null });
  const { commitWidth, resetWidth, setWidth, width } = usePanelWidth(USAGE_WIDTH);
  const panelStyle = { "--usage-width": `${width}px` } as CSSProperties;

  return (
    <section className="usage-panel" aria-label="额度用量" style={panelStyle}>
      <header className="usage-head">
        <Gauge aria-hidden="true" size={ICON.md} />
        <h2>额度用量</h2>
        <button
          className="icon-button icon-button--sm"
          disabled={usage.loading}
          onClick={() => void usage.reload()}
          title="重新扫描会话日志"
          type="button"
        >
          <RefreshCcw aria-hidden="true" size={ICON.sm} />
        </button>
        <button className="icon-button icon-button--sm" onClick={onClose} title="关闭" type="button">
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      <div className="usage-filters">
        <div className="usage-segments" role="group" aria-label="统计窗口">
          {USAGE_WINDOWS.map((option) => (
            <button
              aria-pressed={usage.windowDays === option.days}
              className={usage.windowDays === option.days ? "is-active" : undefined}
              key={option.label}
              onClick={() => usage.setWindowDays(option.days)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        {usage.canScope ? (
          <label className="usage-scope">
            <input
              checked={usage.scoped}
              onChange={(event) => usage.setScoped(event.target.checked)}
              type="checkbox"
            />
            <span>只看 {project?.name}</span>
          </label>
        ) : null}
      </div>

      {usage.failure ? (
        <p className="usage-error" role="alert">
          <AlertTriangle aria-hidden="true" size={ICON.sm} />
          {failureLabel(usage.failure)}
        </p>
      ) : null}

      <div className="usage-body">
        {usage.report ? <UsageContent report={usage.report} /> : null}
        {!usage.report && usage.loading ? <p className="usage-hint">正在扫描会话日志…</p> : null}
      </div>

      <PanelResizeHandle
        label="调整额度面板宽度"
        onCommit={commitWidth}
        onReset={resetWidth}
        onResize={setWidth}
        spec={USAGE_WIDTH}
        width={width}
      />
    </section>
  );
}

function UsageContent({ report }: { report: UsageReport }) {
  const total = totalTokens(report.totals);

  if (report.models.length === 0) {
    return (
      <p className="usage-hint">
        该范围内没有用量记录。用量来自 Codex 与 Claude Code 写在本机的会话日志，
        跑过会话后才会出现。
      </p>
    );
  }

  return (
    <>
      <div className="usage-total">
        <span>总用量</span>
        <strong title={`${formatExact(total)} tokens`}>{formatTokens(total)}</strong>
      </div>

      {report.quotas.length > 0 ? (
        <section className="usage-section" aria-label="套餐额度">
          <h3>套餐额度</h3>
          {report.quotas.map((quota) => (
            <QuotaBar key={quota.agent} quota={quota} />
          ))}
          {/* Claude Code 的会话日志不写额度字段，缺失要说明原因而不是留白 */}
          <p className="usage-note">Claude Code 的会话日志不含额度信息，仅统计 token。</p>
        </section>
      ) : null}

      <section className="usage-section" aria-label="按模型">
        <h3>按模型</h3>
        <ul className="usage-models">
          {report.models.map((model) => (
            <ModelRow key={`${model.agent}:${model.model}`} model={model} total={total} />
          ))}
        </ul>
      </section>

      {report.projects.length > 1 ? (
        <section className="usage-section" aria-label="按项目">
          <h3>按项目</h3>
          <ul className="usage-projects">
            {report.projects.slice(0, 6).map((item) => (
              <li key={item.rootPath}>
                <span title={item.rootPath}>{item.name}</span>
                <em title={`${formatExact(totalTokens(item.tokens))} tokens`}>
                  {formatTokens(totalTokens(item.tokens))}
                </em>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="usage-note">
        扫描 {report.scannedFiles} 个会话日志
        {report.skippedFiles > 0 ? `，跳过 ${report.skippedFiles} 个` : ""}。
      </p>
    </>
  );
}

function ModelRow({ model, total }: { model: ModelUsage; total: number }) {
  const modelTotal = totalTokens(model.tokens);
  const share = total > 0 ? (modelTotal / total) * 100 : 0;
  const lastUsed = formatRelative(model.lastUsedAt);

  return (
    <li className="usage-model">
      <div className="usage-model__head">
        <span className="usage-model__name" title={model.model}>
          {model.model}
        </span>
        <span className="usage-model__total" title={`${formatExact(modelTotal)} tokens`}>
          {formatTokens(modelTotal)}
        </span>
      </div>
      <div className="usage-model__bar">
        <i style={{ width: `${share}%` }} />
      </div>
      <div className="usage-model__meta">
        <span>{agentLabel(model.agent)}</span>
        <span title="输出 token">出 {formatTokens(model.tokens.output)}</span>
        <span title="未命中缓存的输入 token">入 {formatTokens(model.tokens.input)}</span>
        <span title="缓存读取 token">缓存 {formatTokens(model.tokens.cachedInput)}</span>
        <span>{model.requests} 次</span>
        {lastUsed ? <span>{lastUsed}</span> : null}
      </div>
    </li>
  );
}
