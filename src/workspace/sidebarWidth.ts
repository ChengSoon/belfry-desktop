export const SIDEBAR_WIDTH_KEY = "otty.sidebar-width.v1";
export const SIDEBAR_WIDTH_DEFAULT = 208;
export const SIDEBAR_WIDTH_COMPACT = 184;
export const SIDEBAR_WIDTH_MIN = 168;
export const SIDEBAR_WIDTH_MAX = 360;
export const SIDEBAR_WIDTH_STEP = 12;

export function clampSidebarWidth(width: number) {
  return Math.round(Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, width)));
}

export function parseSidebarWidth(value: string | null, fallback = SIDEBAR_WIDTH_DEFAULT) {
  if (value === null || value.trim() === "") return clampSidebarWidth(fallback);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : clampSidebarWidth(fallback);
}

export function loadSidebarWidth(
  fallback = SIDEBAR_WIDTH_DEFAULT,
  storage: Pick<Storage, "getItem"> = localStorage,
) {
  try {
    return parseSidebarWidth(storage.getItem(SIDEBAR_WIDTH_KEY), fallback);
  } catch {
    return clampSidebarWidth(fallback);
  }
}

export function saveSidebarWidth(
  width: number,
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // 存储不可用时仍保留本次会话内的拖拽结果。
  }
}

export function sidebarWidthFromKey(key: string, width: number) {
  if (key === "ArrowLeft") return clampSidebarWidth(width - SIDEBAR_WIDTH_STEP);
  if (key === "ArrowRight") return clampSidebarWidth(width + SIDEBAR_WIDTH_STEP);
  if (key === "Home") return SIDEBAR_WIDTH_MIN;
  if (key === "End") return SIDEBAR_WIDTH_MAX;
  return null;
}
