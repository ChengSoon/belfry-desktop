import type { DropEdge, Rect } from "./contracts";

/** 边缘感应带占窗格短边的比例，超出则算中心。 */
const EDGE_BAND = 0.3;

/**
 * 指针落在窗格的哪条边上。取"到四条边的相对距离"的最小者：
 * 按相对距离而非绝对像素，窄窗格的感应带才不会把整个窗格吃满。
 */
export function dropEdgeAt(
  rect: { width: number; height: number },
  offsetX: number,
  offsetY: number,
): DropEdge {
  if (rect.width <= 0 || rect.height <= 0) return "center";
  const x = offsetX / rect.width;
  const y = offsetY / rect.height;
  const distances = [
    { edge: "left" as const, value: x },
    { edge: "right" as const, value: 1 - x },
    { edge: "top" as const, value: y },
    { edge: "bottom" as const, value: 1 - y },
  ];
  const nearest = distances.reduce((min, item) => (item.value < min.value ? item : min));
  return nearest.value < EDGE_BAND ? nearest.edge : "center";
}

/** 落点高亮铺在窗格的哪半边——中心时铺满整格。坐标相对窗格自身。 */
export function dropIndicatorRect(edge: DropEdge): Rect {
  switch (edge) {
    case "left":
      return { left: 0, top: 0, width: 50, height: 100 };
    case "right":
      return { left: 50, top: 0, width: 50, height: 100 };
    case "top":
      return { left: 0, top: 0, width: 100, height: 50 };
    case "bottom":
      return { left: 0, top: 50, width: 100, height: 50 };
    default:
      return { left: 0, top: 0, width: 100, height: 100 };
  }
}

/** 换算到舞台坐标系，指示器就能和窗格用同一套绝对定位。 */
export function composeDropIndicator(pane: Rect, edge: DropEdge): Rect {
  const inner = dropIndicatorRect(edge);
  return {
    left: pane.left + (pane.width * inner.left) / 100,
    top: pane.top + (pane.height * inner.top) / 100,
    width: (pane.width * inner.width) / 100,
    height: (pane.height * inner.height) / 100,
  };
}
