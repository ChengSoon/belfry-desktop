import type { FontWeight, ITerminalOptions } from "@xterm/xterm";
import { isLightTheme, type TerminalTheme } from "../theme/xtermTheme";

const FONT_LOAD_SAMPLE = "Belfry 终端";
const MEASUREMENT_FONT_WEIGHT = 400;

/** Windows 默认字体随包提供真实的 400/500/600，亮色补偿不再依赖系统的 Medium。 */
export function terminalFontWeights(theme: TerminalTheme): {
  fontWeight: FontWeight;
  fontWeightBold: FontWeight;
} {
  return isLightTheme(theme)
    ? { fontWeight: 500, fontWeightBold: 600 }
    : { fontWeight: 400, fontWeightBold: 500 };
}

/** 测宽用 Regular；正文、粗体及中文都要就绪后才能清掉回退字形的图集。 */
export async function loadTerminalFonts(options: ITerminalOptions): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const { fontFamily, fontSize, fontWeight, fontWeightBold } = options;
  if (!fontFamily || !fontSize) return;
  const weights = new Set([MEASUREMENT_FONT_WEIGHT, fontWeight, fontWeightBold]);
  await Promise.all([...weights].filter((weight) => weight !== undefined).map((weight) =>
    document.fonts.load(`${weight} ${fontSize}px ${fontFamily}`, FONT_LOAD_SAMPLE)
      // 某个字体文件加载失败时，仍等待其它字重，并让终端使用可用的回退字体。
      .catch(() => []),
  ));
}
