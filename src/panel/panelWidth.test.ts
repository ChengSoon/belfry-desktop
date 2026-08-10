import { describe, expect, it } from "vitest";
import { USAGE_WIDTH } from "../usage/usageWidth";
import { SIDEBAR_WIDTH } from "../workspace/sidebarWidth";
import { clampPanelWidth, panelWidthDelta, panelWidthFromKey, parsePanelWidth } from "./panelWidth";

describe("panel width", () => {
  it("clamps persisted widths to the supported range", () => {
    expect(parsePanelWidth(SIDEBAR_WIDTH, String(SIDEBAR_WIDTH.min - 1))).toBe(SIDEBAR_WIDTH.min);
    expect(parsePanelWidth(SIDEBAR_WIDTH, String(SIDEBAR_WIDTH.max + 1))).toBe(SIDEBAR_WIDTH.max);
    expect(parsePanelWidth(SIDEBAR_WIDTH, "invalid")).toBe(SIDEBAR_WIDTH.defaultWidth);
    expect(parsePanelWidth(USAGE_WIDTH, null)).toBe(USAGE_WIDTH.defaultWidth);
  });

  it("rounds pointer-driven widths to whole pixels", () => {
    expect(clampPanelWidth(SIDEBAR_WIDTH, SIDEBAR_WIDTH.defaultWidth + 0.6))
      .toBe(SIDEBAR_WIDTH.defaultWidth + 1);
  });

  it("grows a left panel rightwards and a right panel leftwards", () => {
    expect(panelWidthDelta(SIDEBAR_WIDTH, 30)).toBe(30);
    expect(panelWidthDelta(USAGE_WIDTH, 30)).toBe(-30);
  });

  it("supports keyboard resizing and range shortcuts", () => {
    const { defaultWidth, step } = SIDEBAR_WIDTH;
    expect(panelWidthFromKey(SIDEBAR_WIDTH, "ArrowLeft", defaultWidth)).toBe(defaultWidth - step);
    expect(panelWidthFromKey(SIDEBAR_WIDTH, "ArrowRight", defaultWidth)).toBe(defaultWidth + step);
    expect(panelWidthFromKey(SIDEBAR_WIDTH, "Home", defaultWidth)).toBe(SIDEBAR_WIDTH.min);
    expect(panelWidthFromKey(SIDEBAR_WIDTH, "End", defaultWidth)).toBe(SIDEBAR_WIDTH.max);
    expect(panelWidthFromKey(SIDEBAR_WIDTH, "Enter", defaultWidth)).toBeNull();
  });

  it("mirrors the arrow keys for a panel pinned to the right edge", () => {
    const { defaultWidth, step } = USAGE_WIDTH;
    expect(panelWidthFromKey(USAGE_WIDTH, "ArrowLeft", defaultWidth)).toBe(defaultWidth + step);
    expect(panelWidthFromKey(USAGE_WIDTH, "ArrowRight", defaultWidth)).toBe(defaultWidth - step);
    // Home/End 说的是最窄/最宽，与面板贴哪边无关。
    expect(panelWidthFromKey(USAGE_WIDTH, "Home", defaultWidth)).toBe(USAGE_WIDTH.min);
    expect(panelWidthFromKey(USAGE_WIDTH, "End", defaultWidth)).toBe(USAGE_WIDTH.max);
  });
});
