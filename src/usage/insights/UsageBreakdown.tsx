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
  const models = groupModels(rows);
  const [limit, setLimit] = useState(PAGE_ITEMS);
  return <section className="usage-breakdown" aria-label="按模型用量">
    <h3>按模型</h3>
    {models.length ? models.slice(0, limit).map((model) => <Disclosure className="usage-model-detail" key={model.id} title={<><span><strong title={model.model}>{model.model}</strong><small>{agentLabel(model.agent)}</small></span>
        <span><b title={formatExact(totalTokens(model.tokens)) + " Token"}>{formatTokens(totalTokens(model.tokens))}</b>
          <CostLabel estimate={estimateRows(model.rows, prices)} /></span></>}>
      <TokenBreakdown tokens={model.tokens} />
      <p className="usage-note">{formatExact(model.requests)} 条有效用量增量</p>
      <PriceSources rows={model.rows} prices={prices} />
    </Disclosure>) : <p className="usage-hint">该范围没有用量记录。</p>}
    {models.length > limit ? <button className="usage-show-more" type="button" onClick={() => setLimit(limit + PAGE_ITEMS)}>
      更多模型 · 还有 {models.length - limit} 个</button> : null}
  </section>;
}

function TokenBreakdown({ tokens }: { tokens: UsageBucket["tokens"] }) {
  return <dl className="usage-token-breakdown">
    {[["新增输入", tokens.input], ["缓存读取", tokens.cachedInput], ["缓存写入", tokens.cacheWrite], ["输出", tokens.output]].map(([label, count]) =>
      <div key={label}><dt>{label}</dt><dd>{formatExact(Number(count))}</dd></div>)}
  </dl>;
}

function PriceSources({ rows, prices }: { rows: UsageBucket[]; prices: PriceBook }) {
  const matches = rows.map(compilePrices(prices)).filter((rule) => rule !== null);
  const rules = [...new Map(matches.map((rule) => [rule.id, rule])).values()];
  return <div className="usage-price-sources">
    {rules.map((rule) => <p key={rule.id}><span>{rule.currency} · {rule.effectiveFrom} 起</span>{rule.source}</p>)}
    {matches.length < rows.length ? <p>部分记录无可用价格或日期，未计入费用。</p> : null}
  </div>;
}

export function ProjectBreakdown({ rows, selected, onSelect }: {
  rows: UsageBucket[]; selected: string | null | undefined; onSelect: (root: string | null) => void;
}) {
  const projects = groupProjects(rows);
  const [limit, setLimit] = useState(PAGE_ITEMS);
  return <Disclosure className="usage-disclosure" title={<>按项目 <small>{projects.length}</small></>}>
    <ul className="usage-project-list">{projects.slice(0, limit).map((project) =>
      <li key={project.id}><button type="button" aria-pressed={selected === project.root} onClick={() => onSelect(project.root)}
        title={project.root ?? "日志未记录项目路径"}>
        <span>{project.name}</span><b>{formatTokens(totalTokens(project.tokens))}</b>
      </button></li>)}</ul>
    {projects.length > limit ? <button className="usage-show-more" type="button" onClick={() => setLimit(limit + PAGE_ITEMS)}>
      更多项目 · 还有 {projects.length - limit} 个</button> : null}
  </Disclosure>;
}
