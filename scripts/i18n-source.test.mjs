import { expect, it } from "vitest";
import { inspect } from "./i18n-source.mjs";

it("finds executable text while excluding comments, regular expressions and type-only strings", () => {
  const source = `// 注释不参与检查
    type Name = "类型"; interface Value { name: "类型" }
    const pattern = /正则/;
    const checked = "可见" satisfies Name;
    const view = <button title="标题">操作 {name}</button>;
    const message = \`你好，\${name}\`;
  `;
  expect(inspect(source, "sample.tsx").records.map(record => record.text)).toEqual(["可见", "标题", "操作 ", "你好，{{name}}"]);
});
