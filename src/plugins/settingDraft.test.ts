import { expect, it } from "vitest";
import { parseSettingDraft } from "./settingDraft";

it("数字设置拒绝空值、不完整输入与十六进制，保留零和小数", () => {
  const setting = { key: "rate", title: "费率", type: "number" as const };
  for (const value of ["", "-", ".", "1e", "0x10"]) expect(() => parseSettingDraft(setting, value)).toThrow("费率");
  expect(parseSettingDraft(setting, "0")).toBe(0);
  expect(parseSettingDraft(setting, "0.125")).toBe(0.125);
});
