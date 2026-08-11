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
  // 滚动条滑块整个藏掉：终端右侧那条灰杠没什么信息量，滚动位置从内容本身就看得出来。
  // 走主题而不是 CSS —— xterm 在运行时把这三个值注入自己的样式表，位置排在我们的 CSS 之后，
  // 且 :hover / .active 两条变体特异度更高，从 CSS 那边压只能靠 !important。
  // 必须写成零透明度的 rgba，不能用 transparent 关键字：xterm 的颜色解析器不认它，
  // 会静默退回内置默认色（前景色 20% 透明度），看起来就像改动没生效。
  // 滚动能力与滑块无关（见 terminal.css 里 .scrollbar 那条），涂透明不影响滚轮和键盘。
  scrollbarSliderBackground: "rgba(0, 0, 0, 0)",
  scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0)",
  scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0)",
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
  // 同 DARK：滑块藏掉，理由见上面那段注释。
  scrollbarSliderBackground: "rgba(0, 0, 0, 0)",
  scrollbarSliderHoverBackground: "rgba(0, 0, 0, 0)",
  scrollbarSliderActiveBackground: "rgba(0, 0, 0, 0)",
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
