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
  //
  // white 从 #5f6169（5.9:1）压到 8.2:1，越过 minimumContrastRatio 的 7 之后
  // xterm 不再改写它，程序原本的配色意图能完整留下。
  //
  // brightBlack 反过来**刻意留在 3.2:1**，不跟着压深——它必须停在 dim 的兜底窗口里。
  // xterm 只在"未 dim 的原色"低于 ratio/2（这里是 3.5）时才为 dim 文字改色，
  // 改了就直接返回、跳过 DIM_OPACITY；一旦原色高过 3.5，兜底不介入，
  // 而 0.5 的透明度照样乘下去，dim 反而更虚。实测：留 3.2:1 时 dim+90 是 3.9:1，
  // 压到 4.9:1 后 dim+90 掉到 2.0:1。非 dim 那侧两种取值都会被兜底拉到 7.6~7.9:1，
  // 没有区别——所以压深它是纯亏。statusline 大量用 dim + 灰，这一档不能让。
  white: "#4a4c53",
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
 * 这份主题是不是浅底的。
 *
 * 从 theme 自己判，不额外收一个 mode 参数：主题本身就是 mode 的产物，
 * 多一个入参就多一个会和 `terminal.options.theme` 失同步的来源。
 * 认不出的写法当暗色——暗色那侧的两项补偿都是"不改动"，是安全的一侧。
 */
export function isLightTheme(theme: TerminalTheme): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(theme.background.trim());
  if (!match) return false;
  const value = Number.parseInt(match[1], 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2] > 0.5;
}

/**
 * xterm 的对比度兜底阈值（`minimumContrastRatio`），亮色开、暗色关。
 *
 * 只在亮色开：浅底上灰度抗锯齿会把深字显细，而暗色靠光渗反而显实，观感本来是好的，
 * 开了只会让这里精心调过的配色被 xterm 改写一遍。
 *
 * 亮色取 7 而不是 WCAG AA 的 4.5，两个理由：
 * 1. dim 文字的兜底目标会被除以 2（`addon-webgl` 的 `_getMinimumContrastColor` 与
 *    `xterm.mjs` 的 `_applyMinimumContrast` 都是 `ratio / (isDim ? 2 : 1)`）。
 *    注意这个除以 2 是**兜底的触发线**，不是保证值：原色高过这条线时兜底根本不介入，
 *    而 `DIM_OPACITY = 0.5` 照样乘下去。取 7 把这条线放到 3.5，
 *    才装得下 brightBlack 这类真正常用于 dim 的灰（见 LIGHT 里那段说明）；
 *    取 4.5 时线只有 2.25，几乎所有灰都会漏出兜底、被砍半。
 * 2. 开背景图时 xterm 拿来算对比度的背景是 `rgba(250, 250, 250, 0)`——RGB 分量被
 *    `withTransparentBackground` 刻意保留了，所以计算不会退化，但偏乐观：
 *    真实底色是画布色与背景图的混合，比 `#fafafa` 更脏（这一段由 veil 的亮色默认值补，
 *    见 background/contracts.ts）。
 *
 * 代价是 7:1 对彩色色号很苛刻，亮色调色板里除 black/brightWhite/foreground 外
 * 全都会被 xterm 往深处改写一档，bright 与常规两档的差别会被压缩。
 * 亮色下可读性优先，这个取舍是有意的。
 */
export function minimumContrastRatio(theme: TerminalTheme): number {
  return isLightTheme(theme) ? 7 : 1;
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
