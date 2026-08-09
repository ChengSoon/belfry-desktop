import type { AgentQuota, QuotaWindow } from "../contracts";
import { agentLabel, formatMoment, formatPercent, formatWindow, percentWidth } from "../format";

/** 用量越高越接近告警色，让接近上限的额度自己跳出来。 */
function toneOf(usedPercent: number) {
  if (usedPercent >= 90) return "danger";
  if (usedPercent >= 70) return "warning";
  return "ok";
}

export function QuotaBar({ quota }: { quota: AgentQuota }) {
  // 两个窗口都可能缺失（实测 secondary 恒为 null），逐个收集非空项。
  const windows: { label: string; value: QuotaWindow }[] = [];
  if (quota.primary) windows.push({ label: "主窗口", value: quota.primary });
  if (quota.secondary) windows.push({ label: "次窗口", value: quota.secondary });

  if (windows.length === 0) return null;

  return (
    <div className="usage-quota">
      <div className="usage-quota__head">
        <strong>{agentLabel(quota.agent)}</strong>
        {quota.planType ? <span className="usage-quota__plan">{quota.planType}</span> : null}
      </div>
      {windows.map(({ label, value }) => (
        <div className="usage-quota__row" key={label}>
          <div className="usage-quota__bar" data-tone={toneOf(value.usedPercent)}>
            <i style={{ width: `${percentWidth(value.usedPercent)}%` }} />
          </div>
          <div className="usage-quota__meta">
            <span>已用 {formatPercent(value.usedPercent)}</span>
            {formatWindow(value.windowMinutes) ? <span>{formatWindow(value.windowMinutes)}</span> : null}
            {formatMoment(value.resetsAt) ? <span>{formatMoment(value.resetsAt)} 重置</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
