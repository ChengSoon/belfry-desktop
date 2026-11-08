import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { setLocalePreference } from "../../i18n";
import { CostLabel } from "./CostLabel";

afterEach(() => setLocalePreference("zh-CN"));

it("未配置价格的用量不显示成零元费用", () => {
  const html = renderToStaticMarkup(<CostLabel estimate={{ amounts: {}, pricedTokens: 0, unpricedTokens: 50 }} />);
  expect(html).toContain("价格未配置");
  expect(html).not.toMatch(/USD|CNY|0\.00/);
});

it("部分估算显式区分覆盖范围，多币种分别显示", () => {
  const html = renderToStaticMarkup(<CostLabel estimate={{ amounts: { USD: 2, CNY: 3 }, pricedTokens: 10, unpricedTokens: 20 }} />);
  expect(html).toMatch(/USD\s2\.00/);
  expect(html).toMatch(/CNY\s3\.00/);
  expect(html).toContain("部分估算");
  expect(html).toContain("20 Token 未计价");
});

it("英文费用按币种格式化并保留小额非零估算", () => {
  setLocalePreference("en");
  const html = renderToStaticMarkup(<CostLabel estimate={{ amounts: { USD: 0.000001 }, pricedTokens: 10, unpricedTokens: 20 }} />);
  expect(html).toMatch(/&lt; USD\s0\.0001/);
  expect(html).toContain("Additional unpriced tokens: 20");
  expect(html).not.toMatch(/\p{Script=Han}/u);
});
