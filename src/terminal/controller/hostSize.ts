/** 终端宿主的最小可用尺寸：低于它一律当成「还没布过局」，而不是「很小」。 */
export const MIN_HOST_WIDTH = 80;
export const MIN_HOST_HEIGHT = 40;

/** 宿主没布局时的兜底网格：xterm 的默认值，也是正常 Agent TUI 画得开的下限。 */
export const FALLBACK_GRID = { cols: 80, rows: 24 } as const;

/**
 * 宿主是不是真的布过局了。
 *
 * 只能信 clientWidth / clientHeight 这类 used value：`display: none` 的子树里
 * getComputedStyle 如实报出**声明值**——`.terminal-canvas` 的 `width: 100%` 被
 * fitAddon 的 parseInt 读成 100px。于是被房间藏起来的工作台（0 宽）被算成「100px 宽」，
 * 拟合出一个 10 列的网格发给后台。10 列宽画不下 Agent 的状态行，屏幕推断永远读到
 * 「空闲」——成员明明正在回话，左侧成员行却一直显示空闲。
 */
export function hostIsLaidOut(host: Pick<HTMLElement, "clientWidth" | "clientHeight">): boolean {
  return host.clientWidth >= MIN_HOST_WIDTH && host.clientHeight >= MIN_HOST_HEIGHT;
}

/** 建会话时要上报的网格：宿主还没布局就用兜底值，别把拟合出来的退化尺寸发给后台。 */
export function initialGrid(
  host: Pick<HTMLElement, "clientWidth" | "clientHeight">,
  terminal: { cols: number; rows: number },
): { cols: number; rows: number } {
  return hostIsLaidOut(host) ? { cols: terminal.cols, rows: terminal.rows } : { ...FALLBACK_GRID };
}
