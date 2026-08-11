import type { PanelWidthSpec } from "../panel/panelWidth";

/* 同 SIDEBAR_WIDTH：usage.css 的 .usage-panel 里也写了一遍，两边要一起改；
   key 同样升到 v2，让按旧字号存下的宽度失效。 */
export const USAGE_WIDTH: PanelWidthSpec = {
  compactWidth: 264,
  defaultWidth: 296,
  edge: "right",
  key: "belfry.usage-width.v2",
  max: 512,
  min: 252,
  step: 12,
};
