import { expect, it } from "vitest";
import { findOption, moveOption, normalizeNumber, numberFromDraft, stepNumber } from "./controlModel";

it("键盘选择跳过禁用项，空列表与全部禁用时没有活动项", () => {
  const options = [{ label: "全部" }, { label: "不可用", disabled: true }, { label: "项目" }];
  expect(moveOption(options, 0, 1)).toBe(2);
  expect(moveOption(options, 2, 1)).toBe(0);
  expect(moveOption(options, 0, -1)).toBe(2);
  expect(moveOption([], -1, 1)).toBe(-1);
  expect(moveOption([{ disabled: true }], -1, 1)).toBe(-1);
});

it("拼音输入完成后可按中文或路径搜索，忽略禁用项", () => {
  const options = [{ label: "不可用", disabled: true }, { label: "当前项目", description: "/work/Belfry" }];
  expect(findOption(options, "项目", -1)).toBe(1);
  expect(findOption(options, "BELFRY", -1)).toBe(1);
  expect(findOption(options, "不可用", -1)).toBe(-1);
});

it("数值草稿的空值与未完成输入不变成零或 NaN", () => {
  for (const value of ["", " ", "-", ".", "1e", "Infinity", "0x10"]) expect(numberFromDraft(value)).toBeNull();
  expect(numberFromDraft("0")).toBe(0);
  expect(numberFromDraft("0.125")).toBe(0.125);
  expect(numberFromDraft("1e-6")).toBe(0.000001);
});

it("步进限制边界并消除浮点误差", () => {
  expect(stepNumber("0.2", 1, { min: 0, max: 1, step: 0.1 })).toBe("0.3");
  expect(stepNumber("0.9", 1, { min: 0, max: 1, step: 0.3 })).toBe("1");
  expect(stepNumber("", -1, { min: 1, max: 10, step: 1 })).toBe("1");
  expect(normalizeNumber(0.2999999999, { min: 0, max: 1, step: 0.1 })).toBe(0.3);
  expect(normalizeNumber(1, { min: 0, max: 1, step: 0.3 })).toBe(1);
});
