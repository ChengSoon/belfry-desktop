import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { CostLabel } from "./CostLabel";

it("未配置价格的用量不显示成零元费用", () => {
  const html = renderToStaticMarkup(<CostLabel estimate={{ amounts: {}, pricedTokens: 0, unpricedTokens: 50 }} />);
  expect(html).toContain("价格未配置");
  expect(html).not.toMatch(/USD|CNY|0\.00/);
});

it("部分估算显式区分覆盖范围，多币种分别显示", () => {
  const html = renderToStaticMarkup(<CostLabel estimate={{ amounts: { USD: 2, CNY: 3 }, pricedTokens: 10, unpricedTokens: 20 }} />);
  expect(html).toContain("USD 2.00");
  expect(html).toContain("CNY 3.00");
  expect(html).toContain("部分估算");
  expect(html).toContain("20 Token 未计价");
});
