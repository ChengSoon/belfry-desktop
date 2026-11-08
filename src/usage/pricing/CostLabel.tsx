import { formatCurrency, t, useTranslation } from "../../i18n";
import { formatTokens } from "../format";
import type { CostEstimate, Currency } from "./contracts";

export function formatCost(amount: number, currency: Currency): string {
  const small = amount > 0 && amount < 0.0001;
  return `${small ? "< " : ""}${formatCurrency(small ? 0.0001 : amount, currency, {
    currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: amount < 1 ? 4 : 2,
  })}`;
}

export function CostLabel({ estimate, empty = false }: { estimate: CostEstimate; empty?: boolean }) {
  useTranslation();
  const amounts = Object.entries(estimate.amounts) as [Currency, number][];
  if (empty) return <span className="usage-insight-muted">{t("usage.CostLabel.text_cc7c55616f")}</span>;
  if (!amounts.length) return <span className="usage-insight-muted">{t("usage.CostLabel.text_ae3f3f2791")}</span>;
  return <span className="usage-cost" title={estimate.unpricedTokens ? t("usage.CostLabel.text_c9100b75bd", { tokens: formatTokens(estimate.unpricedTokens) }) : undefined}>
    {amounts.map(([currency, amount]) => <span key={currency}>{formatCost(amount, currency)}</span>)}
    {estimate.unpricedTokens ? <small>{t("usage.CostLabel.text_da0a0e663b")}</small> : null}
  </span>;
}
