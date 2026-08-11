import { describe, expect, it } from "vitest";
import type { LayoutNode } from "./contracts";
import {
  clampRatio,
  computeFrames,
  hasTab,
  layoutTabIds,
  leaf,
  MIN_RATIO,
  pruneLayout,
  ratioAt,
  removeLeaf,
  replaceLeaf,
  setRatio,
  splitLeaf,
} from "./tree";

const rectOf = (node: LayoutNode, tabId: string) =>
  computeFrames(node).panes.find((pane) => pane.tabId === tabId)?.rect;

describe("splitLeaf", () => {
  it("右边落点把新会话放在目标右侧", () => {
    const next = splitLeaf(leaf("a"), "a", "b", "right");
    expect(layoutTabIds(next)).toEqual(["a", "b"]);
    expect(rectOf(next, "a")).toEqual({ left: 0, top: 0, width: 50, height: 100 });
    expect(rectOf(next, "b")).toEqual({ left: 50, top: 0, width: 50, height: 100 });
  });

  it("左边落点把新会话放在目标左侧", () => {
    const next = splitLeaf(leaf("a"), "a", "b", "left");
    expect(layoutTabIds(next)).toEqual(["b", "a"]);
  });

  it("下边落点纵向劈开", () => {
    const next = splitLeaf(leaf("a"), "a", "b", "bottom");
    expect(rectOf(next, "a")).toEqual({ left: 0, top: 0, width: 100, height: 50 });
    expect(rectOf(next, "b")).toEqual({ left: 0, top: 50, width: 100, height: 50 });
  });

  it("中心落点顶掉目标会话", () => {
    const next = splitLeaf(leaf("a"), "a", "b", "center");
    expect(layoutTabIds(next)).toEqual(["b"]);
  });

  it("拖到自己身上不动", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(splitLeaf(root, "a", "a", "left")).toBe(root);
  });

  it("窗格互拖只搬位置，不会留下重复叶子", () => {
    // a | b 上下再劈出 c，然后把 c 拖到 a 的下边。
    const twoUp = splitLeaf(leaf("a"), "a", "b", "right");
    const three = splitLeaf(twoUp, "b", "c", "bottom");
    expect(layoutTabIds(three)).toEqual(["a", "b", "c"]);
    const moved = splitLeaf(three, "a", "c", "bottom");
    expect(layoutTabIds(moved)).toEqual(["a", "c", "b"]);
    expect(rectOf(moved, "b")).toEqual({ left: 50, top: 0, width: 50, height: 100 });
  });

  it("源窗格摘走后目标被塌缩掉时，退化成只留拖动的那个", () => {
    // a | b 里把 a 拖到 b 上：摘掉 a 后树只剩 b，center 语义下就是顶掉 b。
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(layoutTabIds(splitLeaf(root, "b", "a", "center"))).toEqual(["a"]);
  });
});

describe("removeLeaf", () => {
  it("父节点塌缩成兄弟", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(removeLeaf(root, "a")).toEqual(leaf("b"));
  });

  it("最后一个叶子被摘走返回 null", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });

  it("摘不存在的会话返回原树", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(removeLeaf(root, "zzz")).toBe(root);
  });

  it("三窗格里摘中间那个，剩下两个的比例重新摊满", () => {
    const three = splitLeaf(splitLeaf(leaf("a"), "a", "b", "right"), "b", "c", "bottom");
    const next = removeLeaf(three, "b");
    expect(layoutTabIds(next!)).toEqual(["a", "c"]);
    expect(rectOf(next!, "c")).toEqual({ left: 50, top: 0, width: 50, height: 100 });
  });
});

describe("pruneLayout", () => {
  it("剔掉已关闭的会话", () => {
    const three = splitLeaf(splitLeaf(leaf("a"), "a", "b", "right"), "b", "c", "bottom");
    const next = pruneLayout(three, new Set(["a", "c"]));
    expect(layoutTabIds(next!)).toEqual(["a", "c"]);
  });

  it("全没了返回 null", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(pruneLayout(root, new Set())).toBeNull();
  });

  it("没有变化时返回原对象，避免白白重渲染", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(pruneLayout(root, new Set(["a", "b"]))).toBe(root);
  });
});

describe("replaceLeaf", () => {
  it("换掉指定叶子承载的会话", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(layoutTabIds(replaceLeaf(root, "b", "c"))).toEqual(["a", "c"]);
  });

  it("目标不在树里时原样返回", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(replaceLeaf(root, "zzz", "c")).toBe(root);
  });
});

describe("setRatio / ratioAt", () => {
  it("按 path 定位到嵌套的 split", () => {
    const three = splitLeaf(splitLeaf(leaf("a"), "a", "b", "right"), "b", "c", "bottom");
    // 根是 a | (b / c)，嵌套的那个 split 在 second 分支上。
    const next = setRatio(three, "1", 0.25);
    expect(ratioAt(next, "1")).toBe(0.25);
    expect(ratioAt(next, "")).toBe(0.5);
    expect(rectOf(next, "b")).toEqual({ left: 50, top: 0, width: 50, height: 25 });
  });

  it("比例被夹在最小窗格之内", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(ratioAt(setRatio(root, "", 0), "")).toBe(MIN_RATIO);
    expect(ratioAt(setRatio(root, "", 1), "")).toBe(1 - MIN_RATIO);
    expect(clampRatio(0.5)).toBe(0.5);
  });
});

describe("computeFrames", () => {
  it("单窗格铺满", () => {
    const frame = computeFrames(leaf("a"));
    expect(frame.panes).toEqual([{ tabId: "a", rect: { left: 0, top: 0, width: 100, height: 100 } }]);
    expect(frame.dividers).toEqual([]);
  });

  it("分隔条落在分界线上，并带上父容器跨度", () => {
    const root = setRatio(splitLeaf(leaf("a"), "a", "b", "right"), "", 0.3);
    const [divider] = computeFrames(root).dividers;
    expect(divider).toEqual({
      path: "",
      direction: "row",
      rect: { left: 30, top: 0, width: 0, height: 100 },
      span: 100,
      ratio: 0.3,
    });
  });

  it("嵌套分屏的分隔条只跨自己那一半", () => {
    const three = splitLeaf(splitLeaf(leaf("a"), "a", "b", "right"), "b", "c", "bottom");
    const nested = computeFrames(three).dividers.find((item) => item.path === "1");
    expect(nested).toEqual({
      path: "1",
      direction: "column",
      rect: { left: 50, top: 50, width: 50, height: 0 },
      span: 100,
      ratio: 0.5,
    });
  });

  it("窗格铺满且互不重叠", () => {
    const three = splitLeaf(splitLeaf(leaf("a"), "a", "b", "right"), "b", "c", "bottom");
    const area = computeFrames(three).panes.reduce(
      (sum, pane) => sum + (pane.rect.width * pane.rect.height) / 100,
      0,
    );
    expect(area).toBeCloseTo(100);
  });

  it("hasTab 认得树里的会话", () => {
    const root = splitLeaf(leaf("a"), "a", "b", "right");
    expect(hasTab(root, "b")).toBe(true);
    expect(hasTab(root, "zzz")).toBe(false);
  });
});
