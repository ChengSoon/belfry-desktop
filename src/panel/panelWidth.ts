/** 可拖拽面板的宽度约束。edge 是面板贴住的窗口一侧，决定拖拽与方向键的正负。 */
export interface PanelWidthSpec {
  key: string;
  defaultWidth: number;
  /** 窄窗口下的初始宽度，用户拖过一次之后就以持久化值为准。 */
  compactWidth: number;
  min: number;
  max: number;
  step: number;
  edge: "left" | "right";
}

export function clampPanelWidth(spec: PanelWidthSpec, width: number) {
  return Math.round(Math.min(spec.max, Math.max(spec.min, width)));
}

export function parsePanelWidth(
  spec: PanelWidthSpec,
  value: string | null,
  fallback = spec.defaultWidth,
) {
  if (value === null || value.trim() === "") return clampPanelWidth(spec, fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampPanelWidth(spec, parsed) : clampPanelWidth(spec, fallback);
}

export function loadPanelWidth(
  spec: PanelWidthSpec,
  fallback = spec.defaultWidth,
  storage: Pick<Storage, "getItem"> = localStorage,
) {
  try {
    return parsePanelWidth(spec, storage.getItem(spec.key), fallback);
  } catch {
    return clampPanelWidth(spec, fallback);
  }
}

export function savePanelWidth(
  spec: PanelWidthSpec,
  width: number,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(spec.key, String(clampPanelWidth(spec, width)));
  } catch {
    // 存储不可用时仍保留本次会话内的拖拽结果。
  }
}

/** 贴右侧的面板把手在左边缘，指针左移才是变宽，指针位移要反过来算。 */
export function panelWidthDelta(spec: PanelWidthSpec, pointerDelta: number) {
  return spec.edge === "right" ? -pointerDelta : pointerDelta;
}

export function panelWidthFromKey(spec: PanelWidthSpec, key: string, width: number) {
  const grow = spec.edge === "right" ? "ArrowLeft" : "ArrowRight";
  const shrink = spec.edge === "right" ? "ArrowRight" : "ArrowLeft";
  if (key === grow) return clampPanelWidth(spec, width + spec.step);
  if (key === shrink) return clampPanelWidth(spec, width - spec.step);
  // Home/End 是"最窄/最宽"的语义，不随 edge 翻转。
  if (key === "Home") return spec.min;
  if (key === "End") return spec.max;
  return null;
}
