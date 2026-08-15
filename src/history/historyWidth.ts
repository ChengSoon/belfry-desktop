import type { PanelWidthSpec } from "../panel/panelWidth";

/* 同 USAGE_WIDTH：history.css 的 .history-panel 里也写了一遍，两边要一起改。 */
export const HISTORY_WIDTH: PanelWidthSpec = {
  compactWidth: 264,
  defaultWidth: 320,
  edge: "right",
  key: "belfry.history-width.v1",
  max: 520,
  min: 260,
  step: 12,
};
