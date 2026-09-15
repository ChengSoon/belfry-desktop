import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import type { TerminalTheme } from "../../theme/xtermTheme";
import { minimumContrastRatio, withTransparentBackground } from "../../theme/xtermTheme";
import type { TypographyRuntime } from "../../typography/contracts";
import { typographyFontStacks } from "../../typography/storage";
import { terminalFontWeights } from "../fontRendering";

export function createXterm(
  theme: TerminalTheme,
  transparent: boolean,
  typography: TypographyRuntime,
) {
  // 配色必须在构造时就位：会话创建请求要带上背景色，而它在挂载的同一个同步块里就发出去了。
  return new Terminal({
    // Unicode provider 使用 xterm 的 proposed API；不显式开启时，首个终端挂载会抛异常并导致整页白屏。
    allowProposedApi: true,
    // 开背景图时必须打开，否则 xterm 会把底色实心涂满、图整个被盖住。
    // 官方说明它对性能有影响，所以没背景图时照旧关着。
    allowTransparency: transparent,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 4,
    fontFamily: typographyFontStacks(typography.fontFamily).mono,
    fontSize: typography.fontSize,
    ...terminalFontWeights(theme),
    lineHeight: 1.35,
    // 亮色下把对比度不够的 ANSI 色号往深处拉一档，暗色关闭。取值理由见 minimumContrastRatio。
    minimumContrastRatio: minimumContrastRatio(theme),
    // 自绘滚动条宽度。默认 14px 在窄窗格里太占地方，收到 8px；
    // 这个值同时控制滚动条与 overview ruler 的宽度（xterm 内部共用）。
    overviewRuler: { width: 8 },
    scrollback: 1000,
    theme: transparent ? withTransparentBackground(theme) : theme,
  });
}

export function applyTypographyOptions(
  terminal: Terminal,
  config: TypographyRuntime,
) {
  terminal.options.fontFamily = typographyFontStacks(config.fontFamily).mono;
  terminal.options.fontSize = config.fontSize;
  terminal.clearTextureAtlas();
}

/* 必须走 WebGL renderer，不是为了性能而是为了画对块字符。
   默认的 DOM renderer 把每格渲染成一个 span：格子背景铺满整格，字形只占字体的 em 盒，
   lineHeight 1.35 多出来的那 35% 行距没有字形覆盖，于是格子背景从字形上下露出来。
   ▀▄█▛▜ 这类块元素本该严丝合缝拼成图形，露出来就断成一条条横缝。
   Claude Code 的 Clawd 吉祥物给那几格显式设了黑底（clawd_background: rgb(0,0,0)），
   缝隙露的就是黑块——亮色主题下尤其刺眼。
   WebGL renderer 对这些码位不走字体，直接按矢量定义铺满整格，无论行高都不留缝。

   拿不到 WebGL 就静默退回 DOM renderer：块字符会难看，但终端本身照常能用，
   为了画得好看而让会话开不起来是不划算的。 */
export function attachWebglRenderer(terminal: Terminal) {
  try {
    const addon = new WebglAddon();
    // 丢上下文后 addon 自己不会恢复，继续挂着只会得到一块空白画布。
    // 卸掉它，xterm 自动落回 DOM renderer。
    addon.onContextLoss(() => addon.dispose());
    terminal.loadAddon(addon);
    return addon;
  } catch {
    return null;
  }
}
