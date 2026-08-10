import type { PanelWidthSpec } from "../panel/panelWidth";

/* 这几个数字在 sidebar.css 的 .sidebar 里还写了一遍（width/min-width/max-width）。
   只改一边的话，CSS 的 min-width 会把 clamp 过的宽度再夹一次，表现为拖不到边界。

   key 升到 v2：宽度偏好是按旧字号拖出来的，字号整体放大后那个值不再合适
   （旧的 360 会让侧栏占掉三分之一窗口），换个键让它自然失效、回到新默认值。 */
export const SIDEBAR_WIDTH: PanelWidthSpec = {
  compactWidth: 200,
  defaultWidth: 228,
  edge: "left",
  key: "otty.sidebar-width.v2",
  max: 392,
  min: 184,
  step: 12,
};
