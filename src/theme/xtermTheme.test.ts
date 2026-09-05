import { describe, expect, it } from "vitest";
import {
  isLightTheme,
  minimumContrastRatio,
  toZeroAlpha,
  withTransparentBackground,
  xtermTheme,
} from "./xtermTheme";

describe("透明背景下的 xterm 主题", () => {
  /**
   * RGB 分量必须原样保留。xterm 会拿 background 和 selectionBackground 预混出
   * 一个不透明的选区色，填成纯黑的话选区会比不开背景图时暗一档。
   */
  it("只归零 alpha，保留 RGB 分量", () => {
    expect(toZeroAlpha("#0a0a0b")).toBe("rgba(10, 10, 11, 0)");
    expect(toZeroAlpha("#fafafa")).toBe("rgba(250, 250, 250, 0)");
    expect(toZeroAlpha("#FFFFFF")).toBe("rgba(255, 255, 255, 0)");
    expect(toZeroAlpha("#000000")).toBe("rgba(0, 0, 0, 0)");
  });

  it("认不出来的写法退回全透明黑，而不是抛错", () => {
    // 至少不会盖住背景图；抛错会把整个终端挂载连带炸掉。
    expect(toZeroAlpha("transparent")).toBe("rgba(0, 0, 0, 0)");
    expect(toZeroAlpha("#abc")).toBe("rgba(0, 0, 0, 0)");
    expect(toZeroAlpha("")).toBe("rgba(0, 0, 0, 0)");
  });

  it("两套主题各自透明化后只有背景色变了", () => {
    for (const mode of ["dark", "light"] as const) {
      const base = xtermTheme(mode);
      const clear = withTransparentBackground(base);
      expect(clear.background).toBe(toZeroAlpha(base.background));
      expect(clear.foreground).toBe(base.foreground);
      expect(clear.selectionBackground).toBe(base.selectionBackground);
      expect(clear.scrollbarSliderBackground).toMatch(/^rgba\(.+, 0\.38\)$/);
      expect(clear.scrollbarSliderHoverBackground).toMatch(/^rgba\(.+, 0\.56\)$/);
      expect(clear.scrollbarSliderActiveBackground).toMatch(/^rgba\(.+, 0\.72\)$/);
      expect(base.overviewRulerBorder).toBe("rgba(0, 0, 0, 0)");
      expect(clear.overviewRulerBorder).toBe(base.overviewRulerBorder);
      // 基准主题不能被就地改掉——它还要喂给 PTY 和 CodexThemeSync
      expect(base.background).toMatch(/^#[0-9a-f]{6}$/i);
      expect(base.scrollbarSliderBackground).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("亮色的对比度兜底", () => {
  it("只在亮色开启，暗色保持关闭", () => {
    // 1 就是 xterm 的默认值，即完全关闭；暗色观感本来是好的，开了只会改写配色。
    expect(minimumContrastRatio(xtermTheme("dark"))).toBe(1);
    expect(minimumContrastRatio(xtermTheme("light"))).toBe(7);
  });

  /* dim 文字的目标会被 xterm 除以 2，取 4.5 时 dim 只剩 2.25:1 仍然虚。 */
  it("亮色取值要让 dim 也过 3:1", () => {
    expect(minimumContrastRatio(xtermTheme("light")) / 2).toBeGreaterThanOrEqual(3);
  });

  it("按背景亮度判亮暗，认不出的写法落到暗色这侧", () => {
    expect(isLightTheme(xtermTheme("light"))).toBe(true);
    expect(isLightTheme(xtermTheme("dark"))).toBe(false);
    // 透明化之后 background 是 rgba(...)。这条路径上不会走到，但落到"不改动"才安全。
    expect(isLightTheme(withTransparentBackground(xtermTheme("light")))).toBe(false);
  });
});

describe("亮色调色板的可读性下限", () => {
  const contrast = (a: string, b: string) => {
    const luminance = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const ratio = channel / 255;
        return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  /* white(37) 是程序输出正文的常用色号：越过兜底线之后 xterm 不再改写它，
     程序原本的配色意图能完整留下。 */
  it("white 自己就过兜底线，xterm 不必改写它", () => {
    const light = xtermTheme("light");
    expect(contrast(light.white!, light.background)).toBeGreaterThanOrEqual(
      minimumContrastRatio(light),
    );
  });

  /**
   * brightBlack 必须留在 dim 的兜底窗口里，别顺手压深。
   *
   * xterm 只在"未 dim 的原色"低于 ratio/2 时才为 dim 文字改色，改了就跳过
   * DIM_OPACITY；原色一旦高过这条线，兜底不介入而 0.5 照样乘下去，dim 反而更虚。
   * 实测：留在窗口内 dim+90 是 3.9:1，压到 4.9:1 后掉到 2.0:1。
   * statusline 大量用 dim + 灰，这一档不能让。
   */
  it("brightBlack 留在 dim 的兜底窗口内", () => {
    const light = xtermTheme("light");
    expect(contrast(light.brightBlack!, light.background)).toBeLessThan(
      minimumContrastRatio(light) / 2,
    );
  });

  /* brightBlack 是"暗淡灰"这个角色，必须比 white 浅一档，否则次要信息反倒比正文更重。 */
  it("brightBlack 仍比 white 浅一档", () => {
    const light = xtermTheme("light");
    expect(contrast(light.brightBlack!, light.background)).toBeLessThan(
      contrast(light.white!, light.background),
    );
  });
});
