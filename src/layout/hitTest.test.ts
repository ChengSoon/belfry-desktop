import { describe, expect, it } from "vitest";
import { computeFrames } from "./tree";
import { leaf } from "./tree";
import { splitLeaf } from "./tree";
import { hitTestPanes, resolveDropRegion, toPixelRect } from "./hitTest";

const STAGE = { left: 200, top: 100, width: 1000, height: 500 };

describe("toPixelRect", () => {
  it("百分比矩形按舞台原点折算", () => {
    expect(toPixelRect({ left: 50, top: 0, width: 50, height: 100 }, STAGE)).toEqual({
      left: 700,
      top: 100,
      width: 500,
      height: 500,
    });
  });
});

describe("hitTestPanes", () => {
  const twoUp = splitLeaf(leaf("a"), "a", "b", "right");
  const panes = computeFrames(twoUp).panes;

  it("命中左窗格的左边缘", () => {
    expect(hitTestPanes(panes, STAGE, 220, 350)).toEqual({ tabId: "a", edge: "left" });
  });

  it("命中右窗格的中心", () => {
    expect(hitTestPanes(panes, STAGE, 950, 350)).toEqual({ tabId: "b", edge: "center" });
  });

  it("命中右窗格的下边缘", () => {
    expect(hitTestPanes(panes, STAGE, 950, 590)).toEqual({ tabId: "b", edge: "bottom" });
  });

  it("指针跑到舞台外也贴回最近的窗格", () => {
    expect(hitTestPanes(panes, STAGE, -500, 350)).toEqual({ tabId: "a", edge: "left" });
    expect(hitTestPanes(panes, STAGE, 9999, 350)).toEqual({ tabId: "b", edge: "right" });
  });

  it("没有窗格时不命中", () => {
    expect(hitTestPanes([], STAGE, 500, 300)).toBeNull();
  });

  it("舞台还没量出尺寸时不命中", () => {
    expect(hitTestPanes(panes, { left: 0, top: 0, width: 0, height: 0 }, 0, 0)).toBeNull();
  });
});

describe("resolveDropRegion", () => {
  const twoUp = splitLeaf(leaf("a"), "a", "b", "right");
  const panes = computeFrames(twoUp).panes;
  // 侧栏紧贴舞台左边界（STAGE.left = 200），和现实里的排布一致：两者不重叠。
  const SIDEBAR = { left: 0, top: 100, width: 200, height: 500 };

  it("ejectable 时指针在侧栏内判为 sidebar", () => {
    expect(resolveDropRegion(panes, STAGE, SIDEBAR, 120, 300, true)).toEqual({ kind: "sidebar" });
  });

  it("ejectable 时指针在侧栏外仍判给窗格", () => {
    expect(resolveDropRegion(panes, STAGE, SIDEBAR, 220, 350, true)).toEqual({
      kind: "pane",
      tabId: "a",
      edge: "left",
    });
  });

  it("不可摘出时侧栏不算落区，回落到窗格", () => {
    expect(resolveDropRegion(panes, STAGE, SIDEBAR, 120, 300, false)).toEqual({
      kind: "pane",
      tabId: "a",
      edge: "left",
    });
  });

  it("没有侧栏矩形时永不判 sidebar", () => {
    expect(resolveDropRegion(panes, STAGE, null, 120, 300, true)).toEqual({
      kind: "pane",
      tabId: "a",
      edge: "left",
    });
  });

  it("往舞台右侧拖出界仍贴回最近的窗格，不会变成摘出", () => {
    expect(resolveDropRegion(panes, STAGE, SIDEBAR, 9999, 300, true)).toEqual({
      kind: "pane",
      tabId: "b",
      edge: "right",
    });
  });

  it("一个窗格都没有时不命中", () => {
    expect(resolveDropRegion([], STAGE, SIDEBAR, 600, 300, true)).toBeNull();
  });
});
