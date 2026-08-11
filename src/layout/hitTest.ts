import type { DropRegion, DropTarget, PaneFrame, Rect } from "./contracts";
import { dropEdgeAt } from "./dropZone";

export interface Viewport {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 百分比矩形折算成舞台内的像素矩形。 */
export function toPixelRect(rect: Rect, stage: Viewport): Viewport {
  return {
    left: stage.left + (stage.width * rect.left) / 100,
    top: stage.top + (stage.height * rect.top) / 100,
    width: (stage.width * rect.width) / 100,
    height: (stage.height * rect.height) / 100,
  };
}

/**
 * 指针命中哪个窗格的哪条边。
 * 纯算术，不碰 DOM——xterm 的画布会吃掉命中测试，而窗格矩形本来就已经算好了。
 * 指针落在舞台外时贴回最近的窗格：拖到边界外一点点还能落，手感更宽容。
 */
export function hitTestPanes(
  panes: readonly PaneFrame[],
  stage: Viewport,
  clientX: number,
  clientY: number,
): DropTarget | null {
  if (panes.length === 0 || stage.width <= 0 || stage.height <= 0) return null;
  const x = clamp(clientX, stage.left, stage.left + stage.width);
  const y = clamp(clientY, stage.top, stage.top + stage.height);
  for (const pane of panes) {
    const box = toPixelRect(pane.rect, stage);
    // 右/下边界用闭区间：相邻窗格共享边界时靠前者接住，最右一列不会漏判。
    const insideX = x >= box.left && x <= box.left + box.width;
    const insideY = y >= box.top && y <= box.top + box.height;
    if (!insideX || !insideY) continue;
    return { tabId: pane.tabId, edge: dropEdgeAt(box, x - box.left, y - box.top) };
  }
  return null;
}

/**
 * 指针当前落在哪个落区。侧栏先问、窗格后问——
 * hitTestPanes 会把舞台外的坐标贴回最近的窗格，先让侧栏接住才拿得到"拖回去"这个结果。
 *
 * ejectable 为假时侧栏不算落区：会话没在分屏里（或分屏就剩它一个）时，
 * "摘出去"无事可做，那就不该给出可以落下的高亮。
 */
export function resolveDropRegion(
  panes: readonly PaneFrame[],
  stage: Viewport,
  sidebar: Viewport | null,
  clientX: number,
  clientY: number,
  ejectable: boolean,
): DropRegion | null {
  if (ejectable && sidebar && contains(sidebar, clientX, clientY)) return { kind: "sidebar" };
  const target = hitTestPanes(panes, stage, clientX, clientY);
  return target ? { kind: "pane", ...target } : null;
}

function contains(box: Viewport, x: number, y: number) {
  return (
    x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
