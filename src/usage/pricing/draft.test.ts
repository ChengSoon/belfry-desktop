import { expect, it } from "vitest";
import { createPriceDraft, priceFromDraft } from "./draft";
import { validatePriceBook } from "./validation";

it("空白费率不能被 Number 转换成免费，四类单价需要明确填写", () => {
  const draft = createPriceDraft(null);
  expect(() => priceFromDraft(draft)).toThrow("免费项目请明确填 0");
  const complete = { ...draft, model: "sample", source: "自定义中转价",
    rates: { input: "0", cachedInput: "0", cacheWrite: "0", output: "0" } };
  const rule = priceFromDraft(complete);
  expect(validatePriceBook({ version: 1, rules: [rule] }).error).toBeNull();
});

it("中文空格路径与显式别名保留，重新编辑不改变历史生效日", () => {
  const draft = { ...createPriceDraft(null), model: "sample-model", source: "测试价",
    projectRoot: "/中文 项目", aliases: "alias-1，alias-2\nalias-3", effectiveFrom: "2026-08-01",
    rates: { input: "1", cachedInput: "0.1", cacheWrite: "2", output: "3" } };
  const rule = priceFromDraft(draft);
  expect(rule.projectRoot).toBe("/中文 项目");
  expect(rule.aliases).toEqual(["alias-1", "alias-2", "alias-3"]);
  expect(createPriceDraft(rule).effectiveFrom).toBe("2026-08-01");
});
