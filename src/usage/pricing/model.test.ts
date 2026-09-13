import { expect, it } from "vitest";
import { estimateRows, matchingPrice, validatePriceBook } from "./model";
import type { PriceBook, PriceRule } from "./contracts";
import type { UsageBucket } from "../insights/contracts";

const day = Date.parse("2026-09-12T00:00:00Z") / 1000;
function row(patch: Partial<UsageBucket> = {}): UsageBucket {
  return { agent: "codex", model: "sample-model", day, projectRoot: "/项目 A",
    projectName: "项目 A", requests: 1,
    tokens: { input: 1_000_000, cachedInput: 2_000_000, cacheWrite: 3_000_000, output: 4_000_000 }, ...patch };
}
function rule(patch: Partial<PriceRule> = {}): PriceRule {
  return { id: "first", agent: "codex", model: "sample-model", aliases: [],
    projectRoot: null, effectiveFrom: "2026-09-01", source: "测试价格，非实际报价", currency: "USD",
    rates: { input: 2, cachedInput: 0.2, cacheWrite: 3, output: 8 }, ...patch };
}
const book = (...rules: PriceRule[]): PriceBook => ({ version: 1, rules });

it("四类 Token 分别计费，缓存读不再重复算输入", () => {
  const result = estimateRows([row()], book(rule()));
  expect(result.amounts.USD).toBeCloseTo(43.4, 8);
  expect(result.unpricedTokens).toBe(0);
  expect(result.pricedTokens).toBe(10_000_000);
});

it("未知模型与无日期的记录保留未计价数量，不生成零元账单", () => {
  const result = estimateRows([row({ model: "unknown" }), row({ day: null })], book(rule()));
  expect(result.amounts).toEqual({});
  expect(result.unpricedTokens).toBe(20_000_000);
  expect(result.pricedTokens).toBe(0);
});

it("仅明确列出的别名匹配，分隔符相似和其他 Agent 不套用价格", () => {
  const prices = book(rule({ aliases: ["documented-alias"] }));
  expect(matchingPrice(row({ model: "documented-alias" }), prices)?.id).toBe("first");
  expect(matchingPrice(row({ model: "sample.model" }), prices)).toBeNull();
  expect(matchingPrice(row({ agent: "claude" }), prices)).toBeNull();
});

it("按生效日期选历史版本，项目中转价优先且不影响其他项目", () => {
  const original = rule();
  const changed = rule({ id: "changed", effectiveFrom: "2026-09-10" });
  const relay = rule({ id: "relay", projectRoot: "/项目 A", effectiveFrom: "2026-09-11" });
  const prices = book(original, changed, relay);
  expect(matchingPrice(row(), prices)?.id).toBe("relay");
  expect(matchingPrice(row({ projectRoot: "/项目 B" }), prices)?.id).toBe("changed");
  expect(matchingPrice(row({ day: Date.parse("2026-09-09T00:00:00Z") / 1000 }), prices)?.id).toBe("first");
  expect(matchingPrice(row({ day: Date.parse("2026-08-31T00:00:00Z") / 1000 }), prices)).toBeNull();
});

it("不同货币分开合计，允许显式免费的已配置费率", () => {
  const prices = book(rule(), rule({ id: "cny", projectRoot: "/项目 B", currency: "CNY",
    rates: { input: 0, cachedInput: 0, cacheWrite: 0, output: 0 } }));
  const result = estimateRows([row(), row({ projectRoot: "/项目 B" })], prices);
  expect(result.amounts.USD).toBeCloseTo(43.4);
  expect(result.amounts.CNY).toBe(0);
  expect(result.unpricedTokens).toBe(0);
});

it("Windows 路径不同写法仍使用同一项目价格，重复规则会被识别", () => {
  const scoped = rule({ projectRoot: "C:\\Work\\项目" });
  expect(matchingPrice(row({ projectRoot: "c:/work/项目/" }), book(scoped))?.id).toBe("first");
  const conflict = rule({ id: "other", projectRoot: "c:/work/项目" });
  expect(validatePriceBook(book(scoped, conflict)).error).toBeTruthy();
});

it("拒绝冲突别名、同日重复规则、非法日期、负价和不支持的存档版本", () => {
  const invalid = [
    book(rule(), rule({ id: "duplicate" })),
    book(rule(), rule({ id: "alias", model: "other", aliases: ["sample-model"] })),
    book(rule({ effectiveFrom: "2026-02-30" })),
    book(rule({ rates: { input: -1, cachedInput: 0, cacheWrite: 0, output: 0 } })),
    { version: 2, rules: [] },
  ];
  for (const value of invalid) expect(validatePriceBook(value).error).toBeTruthy();
  expect(validatePriceBook(book(rule())).error).toBeNull();
});
