import type { PanelWidthSpec } from "../panel/panelWidth";

/* 同 HISTORY_WIDTH：room.css 的 .room-view 里也写了 300 兜底，两边要一起改。
   右栏两种形态（「任务与决定」/「看终端」）共用这一份宽度：它们占同一列，
   拖一次两处都合适，不必各记各的。 */
export const ROOM_ASIDE_WIDTH: PanelWidthSpec = {
  compactWidth: 260,
  defaultWidth: 300,
  edge: "right",
  key: "belfry.rooms.v1.aside-width",
  max: 560,
  min: 240,
  step: 12,
};
