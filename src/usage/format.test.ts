import { describe, expect, it } from "vitest";
import type { TokenTotals } from "./contracts";
import {
  formatMoment,
  formatPercent,
  formatRelative,
  formatTokens,
  formatWindow,
  percentWidth,
  totalTokens,
} from "./format";

const tokens = (partial: Partial<TokenTotals>): TokenTotals => ({
  input: 0,
  cachedInput: 0,
  cacheWrite: 0,
  output: 0,
  ...partial,
});

describe("totalTokens", () => {
  it("四类相加，与后端 total() 口径一致", () => {
    expect(
      totalTokens(tokens({ input: 1, cachedInput: 2, cacheWrite: 3, output: 4 })),
    ).toBe(10);
  });

  it("全零返回 0", () => {
    expect(totalTokens(tokens({}))).toBe(0);
  });
});

describe("formatTokens", () => {
  it("按量级选单位并保留一位小数", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1000)).toBe("1k");
    expect(formatTokens(12_340)).toBe("12.3k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(780_562_854)).toBe("781M");
    expect(formatTokens(2_500_000_000)).toBe("2.5B");
  });

  it("三位数以上省略小数，保持列宽一致", () => {
    expect(formatTokens(131_606_642)).toBe("132M");
    expect(formatTokens(556_045_161)).toBe("556M");
    expect(formatTokens(872_600)).toBe("873k");
  });

  it("整数量级不显示多余的 .0", () => {
    expect(formatTokens(2_000_000)).toBe("2M");
    expect(formatTokens(5000)).toBe("5k");
  });

  it("非法输入退化为 0 而不是 NaN", () => {
    expect(formatTokens(Number.NaN)).toBe("0");
    expect(formatTokens(-100)).toBe("0");
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("formatPercent", () => {
  it("整数不带小数位", () => {
    expect(formatPercent(63)).toBe("63%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("小数保留一位", () => {
    expect(formatPercent(63.25)).toBe("63.3%");
  });

  it("越界值收敛到 0..100", () => {
    expect(formatPercent(120)).toBe("100%");
    expect(formatPercent(-5)).toBe("0%");
  });
});

describe("percentWidth", () => {
  it("截断到 0..100，避免进度条溢出", () => {
    expect(percentWidth(63)).toBe(63);
    expect(percentWidth(150)).toBe(100);
    expect(percentWidth(-1)).toBe(0);
    expect(percentWidth(Number.NaN)).toBe(0);
  });
});

describe("formatWindow", () => {
  it("整天数换算成天（Codex 实测 10080 分钟）", () => {
    expect(formatWindow(10080)).toBe("7 天窗口");
    expect(formatWindow(1440)).toBe("1 天窗口");
  });

  it("整小时换算成小时", () => {
    expect(formatWindow(300)).toBe("5 小时窗口");
  });

  it("零散分钟保留分钟", () => {
    expect(formatWindow(90)).toBe("90 分钟窗口");
  });

  it("缺失或非正数返回 null", () => {
    expect(formatWindow(null)).toBeNull();
    expect(formatWindow(0)).toBeNull();
  });
});

describe("formatMoment", () => {
  it("null 不渲染", () => {
    expect(formatMoment(null)).toBeNull();
    expect(formatMoment(0)).toBeNull();
  });

  it("epoch 秒按本地时区格式化", () => {
    const text = formatMoment(1786880098);
    expect(text).toBeTruthy();
    expect(text).toMatch(/\d{2}\/\d{2}/);
  });
});

describe("formatRelative", () => {
  const now = 1_786_290_000_000;

  it("按量级选择单位", () => {
    expect(formatRelative(now / 1000 - 30, now)).toBe("刚刚");
    expect(formatRelative(now / 1000 - 600, now)).toBe("10 分钟前");
    expect(formatRelative(now / 1000 - 7200, now)).toBe("2 小时前");
    expect(formatRelative(now / 1000 - 259200, now)).toBe("3 天前");
  });

  it("时钟漂移导致的未来时间不显示负值", () => {
    expect(formatRelative(now / 1000 + 500, now)).toBe("刚刚");
  });

  it("缺失时间返回 null", () => {
    expect(formatRelative(null, now)).toBeNull();
  });
});
