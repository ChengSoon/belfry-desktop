import { DEFAULT_TYPOGRAPHY } from "./contracts";

const MIN_UI_FONT_SIZE = 10;

export interface TypographySizeTokens {
  xs: number;
  sm: number;
  md: number;
  display: number;
}

/** 保持默认 12/13/14/20 的层级关系，随全局字号一起增减。 */
export function typographySizeTokens(fontSize: number): TypographySizeTokens {
  const delta = fontSize - DEFAULT_TYPOGRAPHY.fontSize;
  return {
    xs: Math.max(MIN_UI_FONT_SIZE, 12 + delta),
    sm: Math.max(MIN_UI_FONT_SIZE, 13 + delta),
    md: Math.max(MIN_UI_FONT_SIZE, 14 + delta),
    display: Math.max(MIN_UI_FONT_SIZE, 20 + delta),
  };
}
