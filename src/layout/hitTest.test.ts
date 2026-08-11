import { describe, expect, it } from "vitest";
import { computeFrames } from "./tree";
import { leaf } from "./tree";
import { splitLeaf } from "./tree";
import { hitTestPanes, toPixelRect } from "./hitTest";

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
