import { describe, expect, it } from "vitest";
import { toZeroAlpha, withTransparentBackground, xtermTheme } from "./xtermTheme";

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
