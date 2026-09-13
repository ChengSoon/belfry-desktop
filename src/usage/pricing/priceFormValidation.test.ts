import { expect, it } from "vitest";
import { createPriceDraft } from "./draft";
import { priceFormError } from "./priceFormValidation";

const valid = { ...createPriceDraft(null), model: "gpt-test", effectiveFrom: "2026-09-12", source: "服务商报价",
  rates: { input: "0", cachedInput: "0.125", cacheWrite: "1e-6", output: "2.5" } };

it("完整价格允许小数、科学计数和明确免费", () => { expect(priceFormError(valid)).toBeNull(); });
it("无效日期与未完成单价不能提交为旧值或零", () => {
  expect(priceFormError({ ...valid, effectiveFrom: "2026-02-30" })).toContain("有效的生效日期");
  for (const input of ["", "1e", "-1", "0x10", "Infinity"]) {
    expect(priceFormError({ ...valid, rates: { ...valid.rates, input } })).toContain("新增输入单价");
  }
  expect(priceFormError({ ...valid, source: " " })).toBe("请填写价格来源");
  expect(priceFormError({ ...valid, model: " " })).toBe("请填写模型名");
});
