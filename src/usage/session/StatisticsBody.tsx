import { formatList, t, useTranslation } from "../../i18n";
import type { SessionStatistics, SessionTokens, StatisticsView } from "./contracts";
import { formatExact, formatMoment, formatTokens } from "../format";

export function StatisticsBody({ state, bound, note }: { state: StatisticsView; bound: boolean; note?: string | null }) {
  useTranslation();
  if (!bound) return <p className="session-stats-note">{note ?? t("usage.StatisticsBody.text_df28ee0521")}</p>;
  return <div className="session-stats-body">
    {state.error ? <p className="session-stats-error" role="alert">{state.error}</p> : null}
    {!state.report && state.loading ? <p className="session-stats-note" role="status">{t("usage.StatisticsBody.text_a94e58077a")}</p> : null}
    {state.report ? <StatisticsContent report={state.report} /> : null}
  </div>;
}

function StatisticsContent({ report }: { report: SessionStatistics }) {
  useTranslation();
  const updated = formatMoment(report.updatedAt);
  return <>
    <div className="session-stats-model"><span>{t("usage.StatisticsBody.text_52f79fed15")}</span><strong>{report.currentModel ?? t("usage.StatisticsBody.text_460b3574e4")}</strong></div>
    {report.models.length > 1 ? <p className="session-stats-note">{t("usage.StatisticsBody.text_93e6939972", { names: formatList(report.models) })}</p> : null}
    <TokenGrid tokens={report.tokens} />
    <section className="session-stats-tools" aria-label={t("usage.StatisticsBody.text_aa25451084")}>
      <h4>{t("usage.StatisticsBody.text_a8ca3c13eb")}<span>{report.toolCount === null ? t("usage.StatisticsBody.text_460b3574e4") : t("usage.StatisticsBody.text_073afa92c0", { count: report.toolCount })}</span></h4>
      {report.tools.length ? <ul>{report.tools.map((tool) => <li key={tool.name}><code>{tool.name}</code><span>{t("usage.StatisticsBody.text_073afa92c0", { count: tool.calls })}</span></li>)}</ul>
        : <p className="session-stats-note">{report.toolCount === 0 ? t("usage.StatisticsBody.text_1916a92d2c") : t("usage.StatisticsBody.text_5dc43ad44e")}</p>}
    </section>
    {report.pending ? <p className="session-stats-note" role="status">{t("usage.StatisticsBody.text_b98ae55a23", { bytes: formatTokens(report.scannedBytes) })}</p> : null}
    {report.note ? <p className="session-stats-note">{report.note}</p> : null}
    <footer className="session-stats-meta"><span>{t("usage.StatisticsBody.text_745f42ae9b", { count: report.sourceFiles })}</span><span>{updated ? t("usage.StatisticsBody.text_26df230afe", { updated: updated }) : t("usage.StatisticsBody.text_75d6ca9a3a")}</span></footer>
  </>;
}

function TokenGrid({ tokens }: { tokens: SessionTokens }) {
  useTranslation();
  const fields = [
    { label: t("usage.StatisticsBody.text_8936889d9d"), value: tokens.input, note: t("usage.StatisticsBody.text_ed0bc16a5a") },
    { label: t("usage.StatisticsBody.text_1ded6559f6"), value: tokens.cachedInput, note: t("usage.StatisticsBody.text_3afec41e60") },
    { label: t("usage.StatisticsBody.text_6078a681a3"), value: tokens.cacheWrite, note: t("usage.StatisticsBody.text_bea340b8da") },
    { label: t("usage.StatisticsBody.text_fb04addb4c"), value: tokens.output, note: t("usage.StatisticsBody.text_40ffa2ee52") },
  ];
  return <dl className="session-stats-tokens" aria-label={t("usage.StatisticsBody.text_3989fb69a5")}>
    {fields.map((field) => <div key={field.label} title={field.note}>
      <dt>{field.label}</dt><dd title={field.value === null ? t("usage.StatisticsBody.text_b9e09ad371") : `${formatExact(field.value)} tokens`}>
        {field.value === null ? <span className="session-stats-unavailable">{t("usage.StatisticsBody.text_460b3574e4")}</span> : formatTokens(field.value)}
      </dd>
    </div>)}
  </dl>;
}
