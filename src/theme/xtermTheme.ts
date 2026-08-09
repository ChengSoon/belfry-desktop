import type { ITheme } from "@xterm/xterm";
import type { ThemeMode } from "./contracts";

/**
 * xterm 读不到 CSS 变量，这里维护一份与 styles.css 令牌对齐的调色板。
 * background 必须与 --canvas 完全一致：终端直接铺在画布上，差一档就会看到色缝。
 */
const DARK: ITheme = {
  background: "#0a0a0b",
  foreground: "#e4e4e7",
  cursor: "#6e8bff",
  cursorAccent: "#0a0a0b",
  selectionBackground: "rgba(110, 139, 255, 0.28)",
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

const LIGHT: ITheme = {
  background: "#fafafa",
  foreground: "#26272b",
  cursor: "#3b5bdb",
  cursorAccent: "#fafafa",
  selectionBackground: "rgba(59, 91, 219, 0.18)",
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

export function xtermTheme(mode: ThemeMode): ITheme {
  return mode === "light" ? LIGHT : DARK;
}
