import { formatDateTime, t, useTranslation } from "../../i18n";
import { Disclosure } from "../../components/controls/Disclosure";
import { Notice } from "../../components/Notice";
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
  useTranslation();
  const [editing, setEditing] = useState<Editing | null>(null);
  const start = (rule: PriceRule | null) => setEditing({ draft: createPriceDraft(rule, rows[0]),
    book: prices.book, raw: prices.raw, existing: rule !== null });
  const save = (rules: PriceRule[]) => {
    if (!editing) return t("usage.PriceBookEditor.text_adbc58769f");
    const error = prices.save({ version: 1, rules }, editing.raw);
    if (!error) setEditing(null);
    return error;
  };
  const projects = groupProjects(rows).filter((item) => item.root !== null).map((item) => ({ root: item.root!, name: item.name }));
  if (project && !projects.some((item) => sameProject(item.root, project.rootPath))) projects.unshift({ root: project.rootPath, name: project.name });
  return <Disclosure className="usage-disclosure usage-pricing" title={<>{t("usage.PriceBookEditor.text_83c6fec6df")}<small>{prices.error ? t("usage.PriceBookEditor.text_b7e3e715f1") : t("usage.PriceBookEditor.text_b9828bc6d8", { count: prices.book.rules.length })}</small></>}>
    {prices.error ? <Notice className="usage-price-error" action={<button type="button" onClick={prices.reload}>{t("usage.PriceBookEditor.text_df7392cc96")}</button>}>
      {prices.error}</Notice> : editing ?
      <PriceRuleForm key={editing.draft.id} initial={editing.draft} rows={rows} projects={projects}
        onCancel={() => setEditing(null)}
        onSave={(rule) => save([...editing.book.rules.filter((item) => item.id !== rule.id), rule])}
        onRemove={editing.existing ? () => save(editing.book.rules.filter((item) => item.id !== editing.draft.id)) : undefined} /> :
      <>
        <p className="usage-note">{t("usage.PriceBookEditor.text_c4d6cc2c2e")}</p>
        <ul className="usage-price-list">{prices.book.rules.map((rule) => <li key={rule.id}>
          <button type="button" onClick={() => start(rule)} aria-label={t("usage.PriceBookEditor.text_ce4855525a", { model: rule.model, effectiveFrom: formatDateTime(`${rule.effectiveFrom}T00:00:00Z`, { dateStyle: "medium", timeZone: "UTC" }) })}>
            <strong>{rule.model}</strong><span>{agentLabel(rule.agent)} · {rule.currency} · {formatDateTime(`${rule.effectiveFrom}T00:00:00Z`, { dateStyle: "medium", timeZone: "UTC" })}</span>
            <small title={rule.projectRoot ?? undefined}>{rule.projectRoot ?? t("usage.PriceBookEditor.text_e3040dfd6b")}</small>
          </button></li>)}</ul>
        <button type="button" disabled={prices.book.rules.length >= MAX_PRICE_RULES} onClick={() => start(null)}>{t("usage.PriceBookEditor.text_db66761103")}</button>
      </>}
  </Disclosure>;
}
