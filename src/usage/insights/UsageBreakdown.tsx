import { formatNumber } from "../../i18n";
import { formatDateTime, t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { agentLabel, formatExact, formatTokens, totalTokens } from "../format";
import { useState } from "react";
import type { PriceBook } from "../pricing/contracts";
import { CostLabel } from "../pricing/CostLabel";
import { estimateRows, compilePrices } from "../pricing/model";
import type { UsageBucket } from "./contracts";
import { groupModels, groupProjects } from "./model";

const PAGE_ITEMS = 5;

export function ModelBreakdown({ rows, prices }: { rows: UsageBucket[]; prices: PriceBook }) {
  useTranslation();
  const models = groupModels(rows);
  const [limit, setLimit] = useState(PAGE_ITEMS);
  return <section className="usage-breakdown" aria-label={t("usage.UsageBreakdown.text_c2eaad292c")}>
    <h3>{t("usage.UsageBreakdown.text_19e7c0223e")}</h3>
    {models.length ? models.slice(0, limit).map((model) => <Disclosure className="usage-model-detail" key={model.id} title={<><span><strong title={model.model}>{model.model}</strong><small>{agentLabel(model.agent)}</small></span>
        <span><b title={formatExact(totalTokens(model.tokens)) + " Token"}>{formatTokens(totalTokens(model.tokens))}</b>
          <CostLabel estimate={estimateRows(model.rows, prices)} /></span></>}>
      <TokenBreakdown tokens={model.tokens} />
      <p className="usage-note">{t("usage.UsageBreakdown.text_86ce2750fe", { count: formatExact(model.requests) })}</p>
      <PriceSources rows={model.rows} prices={prices} />
    </Disclosure>) : <p className="usage-hint">{t("usage.UsageBreakdown.text_ce208bb160")}</p>}
    {models.length > limit ? <button className="usage-show-more" type="button" onClick={() => setLimit(limit + PAGE_ITEMS)}>{t("usage.UsageBreakdown.text_76ab572143", { count: models.length - limit })}</button> : null}
  </section>;
}

function TokenBreakdown({ tokens }: { tokens: UsageBucket["tokens"] }) {
  useTranslation();
  return <dl className="usage-token-breakdown">
    {[[t("usage.UsageBreakdown.text_8936889d9d"), tokens.input], [t("usage.UsageBreakdown.text_1ded6559f6"), tokens.cachedInput], [t("usage.UsageBreakdown.text_6078a681a3"), tokens.cacheWrite], [t("usage.UsageBreakdown.text_fb04addb4c"), tokens.output]].map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{formatExact(Number(count))}</dd></div>)}
  </dl>;
}

function PriceSources({ rows, prices }: { rows: UsageBucket[]; prices: PriceBook }) {
  useTranslation();
  const matches = rows.map(compilePrices(prices)).filter((rule) => rule !== null);
  const rules = [...new Map(matches.map((rule) => [rule.id, rule])).values()];
  return <div className="usage-price-sources">
    {rules.map((rule) => <p key={rule.id}><span>{t("usage.UsageBreakdown.text_0af00e8b13", { currency: rule.currency, effectiveFrom: formatDateTime(`${rule.effectiveFrom}T00:00:00Z`, { dateStyle: "medium", timeZone: "UTC" }) })}</span>{rule.source}</p>)}
    {matches.length < rows.length ? <p>{t("usage.UsageBreakdown.text_f8b73b0a86")}</p> : null}
  </div>;
}

export function ProjectBreakdown({ rows, selected, onSelect }: {
  rows: UsageBucket[]; selected: string | null | undefined; onSelect: (root: string | null) => void;
}) {
  useTranslation();
  const projects = groupProjects(rows);
  const [limit, setLimit] = useState(PAGE_ITEMS);
  return <Disclosure className="usage-disclosure" title={<>{t("usage.UsageBreakdown.text_85c489da89")}<small>{formatNumber(projects.length)}</small></>}>
    <ul className="usage-project-list">{projects.slice(0, limit).map((project) =>
      <li key={project.id}><button type="button" aria-pressed={selected === project.root} onClick={() => onSelect(project.root)}
        title={project.root ?? t("usage.UsageBreakdown.text_41d8a0a85c")}>
        <span>{project.name}</span><b>{formatTokens(totalTokens(project.tokens))}</b>
      </button></li>)}</ul>
    {projects.length > limit ? <button className="usage-show-more" type="button" onClick={() => setLimit(limit + PAGE_ITEMS)}>{t("usage.UsageBreakdown.text_d5919ad2c7", { count: projects.length - limit })}</button> : null}
  </Disclosure>;
}
