import { describe, expect, it } from "vitest";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  clampSidebarWidth,
  parseSidebarWidth,
  sidebarWidthFromKey,
} from "./sidebarWidth";

describe("sidebar width", () => {
  it("clamps persisted widths to the supported range", () => {
    expect(parseSidebarWidth("120")).toBe(SIDEBAR_WIDTH_MIN);
    expect(parseSidebarWidth("420")).toBe(SIDEBAR_WIDTH_MAX);
    expect(parseSidebarWidth("invalid")).toBe(SIDEBAR_WIDTH_DEFAULT);
  });

  it("rounds pointer-driven widths to whole pixels", () => {
    expect(clampSidebarWidth(241.6)).toBe(242);
  });

  it("supports keyboard resizing and range shortcuts", () => {
    expect(sidebarWidthFromKey("ArrowLeft", 208)).toBe(196);
    expect(sidebarWidthFromKey("ArrowRight", 208)).toBe(220);
    expect(sidebarWidthFromKey("Home", 208)).toBe(SIDEBAR_WIDTH_MIN);
    expect(sidebarWidthFromKey("End", 208)).toBe(SIDEBAR_WIDTH_MAX);
    expect(sidebarWidthFromKey("Enter", 208)).toBeNull();
  });
});
