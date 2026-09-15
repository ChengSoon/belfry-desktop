import { Disclosure } from "../../components/controls/Disclosure";
import { useState } from "react";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { agentLabel } from "../format";
import type { UsageBucket } from "../insights/contracts";
import { groupProjects, sameProject } from "../insights/model";
import { MAX_PRICE_RULES, type PriceBook, type PriceRule } from "./contracts";
import { createPriceDraft, type PriceDraft } from "./draft";
import { PriceRuleForm } from "./PriceRuleForm";
import type { PriceBookModel } from "./usePriceBook";
import "./priceBook.css";

interface Editing { draft: PriceDraft; book: PriceBook; raw: string | null; existing: boolean }

export function PriceBookEditor({ prices, rows, project }: {
  prices: PriceBookModel; rows: UsageBucket[]; project: ProjectWorkspace | null;
}) {
  const [editing, setEditing] = useState<Editing | null>(null);
  const start = (rule: PriceRule | null) => setEditing({ draft: createPriceDraft(rule, rows[0]),
    book: prices.book, raw: prices.raw, existing: rule !== null });
  const save = (rules: PriceRule[]) => {
    if (!editing) return "请重新打开价格编辑";
    const error = prices.save({ version: 1, rules }, editing.raw);
    if (!error) setEditing(null);
    return error;
  };
  const projects = groupProjects(rows).filter((item) => item.root !== null).map((item) => ({ root: item.root!, name: item.name }));
  if (project && !projects.some((item) => sameProject(item.root, project.rootPath))) projects.unshift({ root: project.rootPath, name: project.name });
  return <Disclosure className="usage-disclosure usage-pricing" title={<>模型定价 <small>{prices.error ? "需要处理" : prices.book.rules.length + " 条"}</small></>}>
    {prices.error ? <><p className="usage-price-error" role="alert">{prices.error}</p>
      <button type="button" onClick={prices.reload}>重新读取</button></> : editing ?
      <PriceRuleForm key={editing.draft.id} initial={editing.draft} rows={rows} projects={projects}
        onCancel={() => setEditing(null)}
        onSave={(rule) => save([...editing.book.rules.filter((item) => item.id !== rule.id), rule])}
        onRemove={editing.existing ? () => save(editing.book.rules.filter((item) => item.id !== editing.draft.id)) : undefined} /> :
      <>
        <p className="usage-note">填写实际使用的官方或中转费率。项目价格优先，模型别名需明确指定。</p>
        <ul className="usage-price-list">{prices.book.rules.map((rule) => <li key={rule.id}>
          <button type="button" onClick={() => start(rule)} aria-label={"编辑 " + rule.model + " " + rule.effectiveFrom + " 价格"}>
            <strong>{rule.model}</strong><span>{agentLabel(rule.agent)} · {rule.currency} · {rule.effectiveFrom}</span>
            <small title={rule.projectRoot ?? undefined}>{rule.projectRoot ?? "全部项目"}</small>
          </button></li>)}</ul>
        <button type="button" disabled={prices.book.rules.length >= MAX_PRICE_RULES} onClick={() => start(null)}>添加价格</button>
      </>}
  </Disclosure>;
}
