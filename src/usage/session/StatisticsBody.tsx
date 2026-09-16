import type { SessionStatistics, SessionTokens, StatisticsView } from "./contracts";
import { formatExact, formatMoment, formatTokens } from "../format";

export function StatisticsBody({ state, bound, note }: { state: StatisticsView; bound: boolean; note?: string | null }) {
  if (!bound) return <p className="session-stats-note">{note ?? "尚未绑定原生会话。可在设置 → 会话状态中启用 Hook，或从历史记录继续会话。"}</p>;
  return <div className="session-stats-body">
    {state.error ? <p className="session-stats-error" role="alert">{state.error}</p> : null}
    {!state.report && state.loading ? <p className="session-stats-note" role="status">正在读取会话日志…</p> : null}
    {state.report ? <StatisticsContent report={state.report} /> : null}
  </div>;
}

function StatisticsContent({ report }: { report: SessionStatistics }) {
  const updated = formatMoment(report.updatedAt);
  return <>
    <div className="session-stats-model"><span>当前模型</span><strong>{report.currentModel ?? "不可用"}</strong></div>
    {report.models.length > 1 ? <p className="session-stats-note">本会话使用过：{report.models.join("、")}</p> : null}
    <TokenGrid tokens={report.tokens} />
    <section className="session-stats-tools" aria-label="工具调用统计">
      <h4>工具调用 <span>{report.toolCount === null ? "不可用" : `${formatExact(report.toolCount)} 次`}</span></h4>
      {report.tools.length ? <ul>{report.tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><span>{formatExact(tool.calls)} 次</span></li>)}</ul>
        : <p className="session-stats-note">{report.toolCount === 0 ? "尚无工具调用记录" : "日志尚未提供工具调用数据"}</p>}
    </section>
    {report.pending ? <p className="session-stats-note" role="status">继续读取日志，已读取 {formatTokens(report.scannedBytes)} 字节…</p> : null}
    {report.note ? <p className="session-stats-note">{report.note}</p> : null}
    <footer className="session-stats-meta"><span>{report.sourceFiles} 个会话日志</span><span>{updated ? `更新于 ${updated}` : "日志未记录时间"}</span></footer>
  </>;
}

function TokenGrid({ tokens }: { tokens: SessionTokens }) {
  const fields = [
    { label: "新增输入", value: tokens.input, note: "不含缓存读取" },
    { label: "缓存读取", value: tokens.cachedInput, note: "命中已有缓存" },
    { label: "缓存写入", value: tokens.cacheWrite, note: "新建缓存输入" },
    { label: "输出", value: tokens.output, note: "包含推理输出，不重复累计" },
  ];
  return <dl className="session-stats-tokens" aria-label="Token 统计">
    {fields.map((field) => <div key={field.label} title={field.note}>
      <dt>{field.label}</dt><dd title={field.value === null ? "日志缺少此字段" : `${formatExact(field.value)} tokens`}>
        {field.value === null ? <span className="session-stats-unavailable">不可用</span> : formatTokens(field.value)}
      </dd>
    </div>)}
  </dl>;
}
