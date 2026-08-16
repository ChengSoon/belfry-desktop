import type { ITheme } from "@xterm/xterm";
import type { ThemeMode } from "./contracts";

/**
 * background / foreground 收窄成必填：PTY 层要拿它们去应答子进程的 OSC 10/11 颜色查询，
 * 少一个就只能不答，可选类型会把这个约束藏起来。
 */
export type TerminalTheme = ITheme & { background: string; foreground: string };

/**
 * xterm 读不到 CSS 变量，这里维护一份与 styles.css 令牌对齐的调色板。
 * background 必须与 --canvas 完全一致：终端直接铺在画布上，差一档就会看到色缝。
 */
const DARK: TerminalTheme = {
  background: "#0a0a0b",
  foreground: "#e4e4e7",
  // 方块光标：取前景色实心铺满，光标下的字符反相成背景色，跟系统终端一致。
  cursor: "#e4e4e7",
  cursorAccent: "#0a0a0b",
  selectionBackground: "rgba(110, 139, 255, 0.28)",
  // 滚动条滑块走 --scrollbar 同款灰阶（xterm 读不到 CSS 变量，色值写死）：
  // hover / 拖动时提亮一档，与全局原生滚动条观感一致。
  // 走主题而不是 CSS —— xterm 在运行时把这三个值注入自己的样式表，位置排在我们的 CSS 之后，
  // 且 :hover / .active 两条变体特异度更高，从 CSS 那边压只能靠 !important。
  // 必须写成不透明的颜色，不能用 transparent 关键字：xterm 的颜色解析器不认它，
  // 会静默退回内置默认色（前景色 20% 透明度），看起来就像改动没生效。
  scrollbarSliderBackground: "#34353c",
  scrollbarSliderHoverBackground: "#4a4b53",
  scrollbarSliderActiveBackground: "#5a5b63",
  // overview ruler 即使没有标记也会画一条默认白色分隔线；保留滚动条宽度，只隐藏这条边。
  overviewRulerBorder: "rgba(0, 0, 0, 0)",
  black: "#26272b",
  red: "#f0796f",
  green: "#57c99a",
  yellow: "#e5b45b",
  blue: "#6e8bff",
  magenta: "#c08ce0",
  cyan: "#5cc0c4",
  white: "#d6d7db",
  brightBlack: "#5a5b63",
  brightRed: "#ff9a91",
  brightGreen: "#7bddb5",
  brightYellow: "#f5ce84",
  brightBlue: "#93a9ff",
  brightMagenta: "#d6a9f0",
  brightCyan: "#7fd6d9",
  brightWhite: "#f4f4f6",
};

const LIGHT: TerminalTheme = {
  background: "#fafafa",
  foreground: "#26272b",
  cursor: "#26272b",
  cursorAccent: "#fafafa",
  selectionBackground: "rgba(59, 91, 219, 0.18)",
  // 同 DARK：滑块走 --scrollbar 同款灰阶，理由见上面那段注释。
  scrollbarSliderBackground: "#c9cbd1",
  scrollbarSliderHoverBackground: "#b4b6bc",
  scrollbarSliderActiveBackground: "#9a9ca3",
  overviewRulerBorder: "rgba(0, 0, 0, 0)",
  black: "#26272b",
  red: "#c4342a",
  green: "#12875a",
  yellow: "#9a6b0f",
  blue: "#3b5bdb",
  magenta: "#8b3fbf",
  cyan: "#0e7490",
  // 亮色下 white/brightWhite 不能真给白：程序常用色号 37 输出正文，浅灰在白底会隐形。
  // 这里按亮色终端惯例压暗，bright 一档留给强调。
  white: "#5f6169",
  brightBlack: "#8a8c94",
  brightRed: "#d94334",
  brightGreen: "#16a06c",
  brightYellow: "#b8811a",
  brightBlue: "#4f6fe8",
  brightMagenta: "#a455d6",
  brightCyan: "#128aa8",
  brightWhite: "#17181b",
};

export function xtermTheme(mode: ThemeMode): TerminalTheme {
  return mode === "light" ? LIGHT : DARK;
}

/**
 * 背景图开启时用的主题：xterm 不能再自己涂底色，否则图整个被盖住。
 *
 * 只把 alpha 归零、**保留 RGB 分量**。xterm 内部会拿 background 与 selectionBackground
 * 预混出一个不透明的选区色（selectionBackgroundOpaque）去画选区，
 * 填纯黑的话选区会比平时暗一档、显得突兀；保留画布色则选区观感与不开背景图时
 * 逐像素一致（实测差异为 0，见 tmp/bg-probe 的对照）。
 */
export function withTransparentBackground(theme: TerminalTheme): TerminalTheme {
  return {
    ...theme,
    background: toZeroAlpha(theme.background),
    scrollbarSliderBackground: toAlpha(theme.scrollbarSliderBackground ?? theme.foreground, 0.38),
    scrollbarSliderHoverBackground: toAlpha(
      theme.scrollbarSliderHoverBackground ?? theme.foreground,
      0.56,
    ),
    scrollbarSliderActiveBackground: toAlpha(
      theme.scrollbarSliderActiveBackground ?? theme.foreground,
      0.72,
    ),
  };
}

/**
 * `#rrggbb` → `rgba(r, g, b, 0)`。
 *
 * 不能图省事写 transparent 关键字：xterm 的颜色解析器不认它，会静默退回内置默认色
 * ——和上面 scrollbarSlider 那三个值踩的是同一个坑。
 */
export function toZeroAlpha(hex: string): string {
  return toAlpha(hex, 0);
}

/** xterm 接受 rgba，但不接受 transparent 关键字；滑块用它保留 RGB 并降低存在感。 */
function toAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return `rgba(0, 0, 0, ${alpha})`;
  const value = Number.parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
