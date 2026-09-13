import type { AgentKind } from "../../workspace/contracts";
import type { TokenTotals } from "../contracts";

export const PRICE_BOOK_KEY = "belfry.usage-prices.v1";
export const PRICE_BOOK_CHANGED = "belfry:usage-prices-changed";
export const MAX_PRICE_RULES = 256;
export const MAX_PRICE_BYTES = 256 * 1024;
export const MAX_RATE = 1_000_000;
export type Currency = "USD" | "CNY";

export interface PriceRule {
  id: string;
  agent: AgentKind;
  model: string;
  aliases: string[];
  projectRoot: string | null;
  /** UTC 生效日期，按天选择对应的历史价格版本。 */
  effectiveFrom: string;
  source: string;
  currency: Currency;
  /** 每百万 Token 单价，四类 Token 互不重叠。 */
  rates: TokenTotals;
}

export interface PriceBook { version: 1; rules: PriceRule[] }
export interface PriceBookState { book: PriceBook; raw: string | null; error: string | null }
export interface CostEstimate {
  amounts: Partial<Record<Currency, number>>;
  pricedTokens: number;
  unpricedTokens: number;
}
export const emptyPriceBook = (): PriceBook => ({ version: 1, rules: [] });
