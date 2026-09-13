import { Disclosure } from "../../components/controls/Disclosure";
import { X } from "lucide-react";
import { useState } from "react";
import { ICON } from "../../theme/sizing";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { QuotaBar } from "../components/QuotaBar";
import { formatExact, formatMoment, formatTokens, totalTokens } from "../format";
import { CostLabel } from "../pricing/CostLabel";
import { estimateRows } from "../pricing/model";
import { PriceBookEditor } from "../pricing/PriceBookEditor";
import { usePriceBook } from "../pricing/usePriceBook";
import type { AnalyticsReport, InsightFilter } from "./contracts";
import { dayLabel, filterRows, sumTokens } from "./model";
import { ModelBreakdown, ProjectBreakdown } from "./UsageBreakdown";
import { UsageTrend } from "./UsageTrend";
import "./usageInsights.css";

export function UsageInsights({ report, project }: { report: AnalyticsReport; project: ProjectWorkspace | null }) {
  const [filter, setFilter] = useState<InsightFilter>({});
  const prices = usePriceBook();
  const rows = filterRows(report.rows, filter);
  const projectRows = filterRows(report.rows, { projectRoot: filter.projectRoot });
  const dateRows = filterRows(report.rows, { day: filter.day });
  const total = totalTokens(sumTokens(rows));
  const estimate = estimateRows(rows, prices.book);
  const undated = projectRows.some((row) => row.day === null);
  return <>
    <InsightSelection filter={filter} report={report} onChange={setFilter} />
    <div className="usage-insight-summary">
      <span>总用量 <small>Token</small></span><strong title={formatExact(total) + " Token"}>{formatTokens(total)}</strong>
      <div><span>预估费用</span><CostLabel estimate={estimate} empty={total === 0} /></div>
      <p>{estimate.unpricedTokens && estimate.pricedTokens ? formatTokens(estimate.unpricedTokens) + " Token 未计价 · " : ""}估算不等同于账单</p>
    </div>
    <UsageTrend key={JSON.stringify(filter.projectRoot) ?? "*"} report={report} rows={projectRows} selected={filter.day}
      onSelect={(day) => setFilter((value) => ({ ...value, day: value.day === day ? undefined : day }))} />
    {undated ? <button className="usage-undated" type="button" aria-pressed={filter.day === null}
      onClick={() => setFilter((value) => ({ ...value, day: value.day === null ? undefined : null }))}>查看日期未知的用量</button> : null}
    <ModelBreakdown rows={rows} prices={prices.book} />
    <ProjectBreakdown rows={dateRows} selected={filter.projectRoot}
      onSelect={(root) => setFilter((value) => ({ ...value, projectRoot: value.projectRoot === root ? undefined : root }))} />
    <PriceBookEditor rows={report.rows} prices={prices} project={project} />
    <UsageSources report={report} />
  </>;
}

function InsightSelection({ filter, report, onChange }: {
  filter: InsightFilter; report: AnalyticsReport; onChange: (value: InsightFilter) => void;
}) {
  if (filter.day === undefined && filter.projectRoot === undefined) return null;
  const project = report.rows.find((row) => row.projectRoot === filter.projectRoot)?.projectName;
  return <div className="usage-selection" aria-label="当前下钻范围">
    {filter.projectRoot !== undefined ? <button type="button" onClick={() => onChange({ ...filter, projectRoot: undefined })}
      title={filter.projectRoot ?? undefined}><span>{project ?? "项目未知"}</span><X size={ICON.xs} aria-label="清除项目筛选" /></button> : null}
    {filter.day !== undefined ? <button type="button" onClick={() => onChange({ ...filter, day: undefined })}>
      <span>{filter.day === null ? "日期未知" : dayLabel(filter.day)}</span><X size={ICON.xs} aria-label="清除日期筛选" /></button> : null}
  </div>;
}

function UsageSources({ report }: { report: AnalyticsReport }) {
  return <Disclosure className="usage-disclosure usage-sources" title={<>额度与统计口径</>}>
    {report.quotas.map((quota) => <QuotaBar quota={quota} key={quota.agent} />)}
    <p className="usage-note">额度来自最后一次日志快照，与日期及项目筛选无关。Claude Code 日志不提供额度。</p>
    <p className="usage-note">按 UTC 自然日统计；近 7/30 天包含今天。新增输入、缓存读取、缓存写入和输出分别计数，推理输出不重复累加。</p>
    <p className="usage-note">Codex 同一请求的流式快照合并后，按最后一次用量变化时间归属日期；只有额度变化的快照不会移动用量日期。</p>
    <p className="usage-note">模型名精确匹配；项目价格优先，再按生效日期选择价格版本。日志无法区分同模型的多个服务商，切换服务后请维护适用价格。</p>
    {report.undatedRecords ? <p className="usage-note">{report.undatedRecords} 条记录无有效日期，{report.windowDays ? "未计入当前日期范围" : "保留在“日期未知”，不估算费用"}。</p> : null}
    <p className="usage-note">扫描 {report.scannedFiles} 个本机会话日志{report.skippedFiles ? "，跳过 " + report.skippedFiles + " 个" : ""}。
      {formatMoment(report.generatedAt) ? "更新于 " + formatMoment(report.generatedAt) : ""}</p>
  </Disclosure>;
}
