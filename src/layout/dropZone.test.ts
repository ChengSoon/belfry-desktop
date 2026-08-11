import { describe, expect, it } from "vitest";
import { composeDropIndicator, dropEdgeAt, dropIndicatorRect } from "./dropZone";

const RECT = { width: 1000, height: 500 };

describe("dropEdgeAt", () => {
  it("靠近某条边时返回该边", () => {
    expect(dropEdgeAt(RECT, 50, 250)).toBe("left");
    expect(dropEdgeAt(RECT, 950, 250)).toBe("right");
    expect(dropEdgeAt(RECT, 500, 20)).toBe("top");
    expect(dropEdgeAt(RECT, 500, 480)).toBe("bottom");
  });

  it("正中间是 center", () => {
    expect(dropEdgeAt(RECT, 500, 250)).toBe("center");
  });

  it("按相对距离判定，窄窗格不会被感应带吃满", () => {
    // 40px 在宽窗格里算 left，在 100px 宽的窄窗格里已经过了中线。
    expect(dropEdgeAt(RECT, 40, 250)).toBe("left");
    expect(dropEdgeAt({ width: 100, height: 500 }, 40, 250)).toBe("center");
  });

  it("角落取最近的那条边", () => {
    // 左上角：x 相对距离 0.01，y 相对距离 0.04，left 更近。
    expect(dropEdgeAt(RECT, 10, 20)).toBe("left");
    expect(dropEdgeAt(RECT, 200, 5)).toBe("top");
  });

  it("零尺寸容器不做判定", () => {
    expect(dropEdgeAt({ width: 0, height: 0 }, 0, 0)).toBe("center");
  });
});

describe("dropIndicatorRect", () => {
  it("边落点铺半格，中心铺满", () => {
    expect(dropIndicatorRect("left")).toEqual({ left: 0, top: 0, width: 50, height: 100 });
    expect(dropIndicatorRect("bottom")).toEqual({ left: 0, top: 50, width: 100, height: 50 });
    expect(dropIndicatorRect("center")).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });
});

describe("composeDropIndicator", () => {
  const pane = { left: 50, top: 0, width: 50, height: 100 };

  it("窗格内的半格换算到舞台坐标", () => {
    expect(composeDropIndicator(pane, "right")).toEqual({ left: 75, top: 0, width: 25, height: 100 });
    expect(composeDropIndicator(pane, "bottom")).toEqual({ left: 50, top: 50, width: 50, height: 50 });
  });

  it("中心落点就是窗格本身", () => {
    expect(composeDropIndicator(pane, "center")).toEqual(pane);
  });
});
