import { expect, it } from "vitest";
import { missingParameters, translationProblems } from "./i18n-validation.mjs";

it("rejects whitespace, punctuation fragments and meaningless interpolation names", () => {
  for (const text of ["会话 ", " 个会话", "，有会话等待选择", "当前：", "Font {{value1}}", "{{value12}} items"]) expect(translationProblems(text).length).toBeGreaterThan(0);
  for (const text of ["{{count}} sessions", "已导入 {{count}} 个字体", "Current: {{name}}", "Enter a valid date.", "请输入有效日期。"])
    expect(translationProblems(text)).toEqual([]);
});

it("requires named interpolation values and a count for plural selection", () => {
  expect(missingParameters(["{{name}}: {{count}} items"], ["name"])).toEqual(["count"]);
  expect(missingParameters(["One item", "Several items"], [], true)).toEqual(["count"]);
  expect(missingParameters(["{{name}}: {{count}} items"], ["name", "count"], true)).toEqual([]);
});
