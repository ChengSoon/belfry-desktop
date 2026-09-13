import { formatTokens } from "../format";
import type { CostEstimate, Currency } from "./contracts";

export function formatCost(amount: number, currency: Currency): string {
  const value = amount > 0 && amount < 0.0001 ? "< 0.0001" : amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2, maximumFractionDigits: amount < 1 ? 4 : 2,
  });
  return currency + " " + value;
}

export function CostLabel({ estimate, empty = false }: { estimate: CostEstimate; empty?: boolean }) {
  const amounts = Object.entries(estimate.amounts) as [Currency, number][];
  if (empty) return <span className="usage-insight-muted">暂无用量</span>;
  if (!amounts.length) return <span className="usage-insight-muted">价格未配置</span>;
  return <span className="usage-cost" title={estimate.unpricedTokens ? "另有 " + formatTokens(estimate.unpricedTokens) + " Token 未计价" : undefined}>
    {amounts.map(([currency, amount]) => <span key={currency}>{formatCost(amount, currency)}</span>)}
    {estimate.unpricedTokens ? <small>部分估算</small> : null}
  </span>;
}
