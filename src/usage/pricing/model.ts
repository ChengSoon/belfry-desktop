import { totalTokens } from "../format";
import type { UsageBucket } from "../insights/contracts";
import type { CostEstimate, PriceBook, PriceRule } from "./contracts";
import { sameProject } from "../insights/model";
export { validatePriceBook } from "./validation";

export function matchingPrice(row: UsageBucket, book: PriceBook): PriceRule | null {
  return compilePrices(book)(row);
}

export function compilePrices(book: PriceBook) {
  const index = new Map<string, PriceRule[]>();
  const rules = [...book.rules].sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom));
  for (const rule of rules) {
    for (const model of [rule.model, ...rule.aliases]) {
      const key = JSON.stringify([rule.agent, model]);
      const entries = index.get(key);
      if (entries) entries.push(rule);
      else index.set(key, [rule]);
    }
  }
  return (row: UsageBucket): PriceRule | null => {
    if (row.day === null) return null;
    const date = new Date(row.day * 1000).toISOString().slice(0, 10);
    const candidates = index.get(JSON.stringify([row.agent, row.model])) ?? [];
    return candidates.find((rule) => rule.projectRoot !== null && sameProject(rule.projectRoot, row.projectRoot) && rule.effectiveFrom <= date)
      ?? candidates.find((rule) => rule.projectRoot === null && rule.effectiveFrom <= date) ?? null;
  };
}

export function estimateRows(rows: UsageBucket[], book: PriceBook): CostEstimate {
  const result: CostEstimate = { amounts: {}, pricedTokens: 0, unpricedTokens: 0 };
  const match = compilePrices(book);
  for (const row of rows) {
    const rule = match(row);
    const tokens = totalTokens(row.tokens);
    if (!rule) { result.unpricedTokens += tokens; continue; }
    const amount = (row.tokens.input * rule.rates.input + row.tokens.cachedInput * rule.rates.cachedInput
      + row.tokens.cacheWrite * rule.rates.cacheWrite + row.tokens.output * rule.rates.output) / 1_000_000;
    result.amounts[rule.currency] = (result.amounts[rule.currency] ?? 0) + amount;
    result.pricedTokens += tokens;
  }
  return result;
}
