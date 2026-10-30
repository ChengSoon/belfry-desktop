import { describe, expect, it } from "vitest";
import { FALLBACK_GRID, hostIsLaidOut, initialGrid, MIN_HOST_HEIGHT, MIN_HOST_WIDTH } from "./hostSize";

const host = (clientWidth: number, clientHeight: number) => ({ clientWidth, clientHeight });

describe("terminal host sizing", () => {
  it("没布过局的宿主一律按「未布局」处理", () => {
    // display:none 的子树里两个 used value 都是 0；工作台被房间藏起来时就是这一档。
    expect(hostIsLaidOut(host(0, 0))).toBe(false);
    expect(hostIsLaidOut(host(MIN_HOST_WIDTH - 1, MIN_HOST_HEIGHT))).toBe(false);
    expect(hostIsLaidOut(host(MIN_HOST_WIDTH, MIN_HOST_HEIGHT - 1))).toBe(false);
    expect(hostIsLaidOut(host(MIN_HOST_WIDTH, MIN_HOST_HEIGHT))).toBe(true);
  });

  it("宿主没布局时上报兜底网格，而不是拟合出来的退化尺寸", () => {
    // 10 列宽是 fitAddon 把 `100%` 读成 100px 之后的产物：那么窄根本画不下状态行。
    expect(initialGrid(host(0, 0), { cols: 10, rows: 3 })).toEqual(FALLBACK_GRID);
    expect(initialGrid(host(0, 0), { cols: 10, rows: 3 })).not.toEqual({ cols: 10, rows: 3 });
  });

  it("布过局的宿主照旧用真实网格", () => {
    expect(initialGrid(host(1200, 800), { cols: 143, rows: 38 })).toEqual({ cols: 143, rows: 38 });
  });
});
