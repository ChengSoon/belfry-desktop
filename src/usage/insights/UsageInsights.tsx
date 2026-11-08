import { t, useTranslation } from "../../i18n";
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
  useTranslation();
  const [filter, setFilter] = useState<InsightFilter>({});
  const prices = usePriceBook();
  const rows = filterRows(report.rows, filter);
  const projectRows = filterRows(report.rows, { projectRoot: filter.projectRoot });
  const dateRows = filterRows(report.rows, { day: filter.day });
  const total = totalTokens(sumTokens(rows));
  const estimate = estimateRows(rows, prices.book);
  const undated = projectRows.some((row) => row.day === null);
  return <>
    {report.skippedFiles || report.diagnostics?.skippedLines ? <p className="usage-note" role="status">{t("usage.UsageInsights.incomplete", { files: report.skippedFiles, lines: report.diagnostics?.skippedLines ?? 0 })}</p> : null}
    <InsightSelection filter={filter} report={report} onChange={setFilter} />
    <div className="usage-insight-summary">
      <span>{t("usage.UsageInsights.text_e506bdf346")}<small>Token</small></span><strong title={formatExact(total) + " Token"}>{formatTokens(total)}</strong>
      <div><span>{t("usage.UsageInsights.text_4b8ee8d70b")}</span><CostLabel estimate={estimate} empty={total === 0} /></div>
      <p>{t(estimate.unpricedTokens && estimate.pricedTokens ? "usage.UsageInsights.partialEstimate" : "usage.UsageInsights.estimate", { tokens: formatTokens(estimate.unpricedTokens) })}</p>
    </div>
    <UsageTrend key={JSON.stringify(filter.projectRoot) ?? "*"} report={report} rows={projectRows} selected={filter.day}
      onSelect={(day) => setFilter((value) => ({ ...value, day: value.day === day ? undefined : day }))} />
    {undated ? <button className="usage-undated" type="button" aria-pressed={filter.day === null}
      onClick={() => setFilter((value) => ({ ...value, day: value.day === null ? undefined : null }))}>{t("usage.UsageInsights.text_6c8a2bc1eb")}</button> : null}
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
  useTranslation();
  if (filter.day === undefined && filter.projectRoot === undefined) return null;
  const project = report.rows.find((row) => row.projectRoot === filter.projectRoot)?.projectName;
  return <div className="usage-selection" aria-label={t("usage.UsageInsights.text_eba51edb77")}>
    {filter.projectRoot !== undefined ? <button type="button" onClick={() => onChange({ ...filter, projectRoot: undefined })}
      title={filter.projectRoot ?? undefined}><span>{project ?? t("usage.UsageInsights.text_6e0bc07ed6")}</span><X size={ICON.xs} aria-label={t("usage.UsageInsights.text_83137649a7")} /></button> : null}
    {filter.day !== undefined ? <button type="button" onClick={() => onChange({ ...filter, day: undefined })}>
      <span>{filter.day === null ? t("usage.UsageInsights.text_0a680746ce") : dayLabel(filter.day)}</span><X size={ICON.xs} aria-label={t("usage.UsageInsights.text_6e30d5e0dc")} /></button> : null}
  </div>;
}

function UsageSources({ report }: { report: AnalyticsReport }) {
  useTranslation();
  return <Disclosure className="usage-disclosure usage-sources" title={<>{t("usage.UsageInsights.text_bf0a6a56cc")}</>}>
    {report.quotas.map((quota) => <QuotaBar quota={quota} key={quota.agent} />)}
    <p className="usage-note">{t("usage.UsageInsights.text_f6a007f769")}</p>
    <p className="usage-note">{t("usage.UsageInsights.text_a11b1413d7")}</p>
    <p className="usage-note">{t("usage.UsageInsights.text_b902a0c87c")}</p>
    <p className="usage-note">{t("usage.UsageInsights.text_aa6d0ae055")}</p>
    {report.undatedRecords ? <p className="usage-note">{t(report.windowDays ? "usage.UsageInsights.undatedExcluded" : "usage.UsageInsights.undatedIncluded", { count: report.undatedRecords })}</p> : null}
    <p className="usage-note">{t("usage.UsageInsights.scanned", { count: report.scannedFiles, skipped: report.skippedFiles })}</p>
    {formatMoment(report.generatedAt) ? <p className="usage-note">{t("usage.UsageInsights.text_e4dab6c447", { time: formatMoment(report.generatedAt) })}</p> : null}
  </Disclosure>;
}
