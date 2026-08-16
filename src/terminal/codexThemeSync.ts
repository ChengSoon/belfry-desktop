import type { TerminalTheme } from "../theme/xtermTheme";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ESC = 0x1b;
const CSI = 0x5b;
const SGR = 0x6d;
const DEC_PRIVATE_MODE_RESET = 0x6c;
const MAX_CSI_BYTES = 128;
const DEFAULT_BACKGROUND = "49";
const INVERSE_OFF = "27";
const MAX_NEUTRAL_CHROMA = 24;
const NEUTRAL_ANSI_BACKGROUNDS = new Set(["40", "47", "100", "107"]);
const CODEX_BANNER = encoder.encode("OpenAI Codex");
const ALT_SCREEN_MODES = new Set(["47", "1047", "1049"]);

/**
 * Codex 会把启动时探测到的终端底色混成输入区背景，并在进程内永久缓存。
 * 透明模式下把 composer 与其他中性底色重置为 ANSI 默认背景，并关闭反显样式。
 * 红、绿、蓝等语义色仍然保留，避免 diff、告警和选项状态丢失层级。
 */
export class CodexThemeSync {
  private readonly sources: Rgb[] = [];
  private readonly pinnedCodexStyles: boolean;
  private rewriteCodexStyles: boolean;
  private target: Rgb;
  private transparent: boolean;
  private pending: number[] = [];
  private bannerMatch = 0;

  constructor(theme: TerminalTheme, transparent = false, rewriteCodexStyles = true) {
    this.target = composerBackground(theme.background);
    this.transparent = transparent;
    this.pinnedCodexStyles = rewriteCodexStyles;
    this.rewriteCodexStyles = rewriteCodexStyles;
    this.remember(this.target);
  }

  setTheme(theme: TerminalTheme, transparent = false) {
    this.target = composerBackground(theme.background);
    this.transparent = transparent;
    this.remember(this.target);
  }

  enableCodexStyles() {
    this.rewriteCodexStyles = true;
    this.bannerMatch = 0;
  }

  get codexStylesEnabled() {
    return this.rewriteCodexStyles;
  }

  rewrite(bytes: Iterable<number>, flush = false) {
    if (!this.rewriteCodexStyles) {
      const chunk = Array.from(bytes);
      this.detectCodex(chunk);
      return this.rewriteBytes(chunk, flush);
    }
    return this.rewriteBytes(bytes, flush);
  }

  private rewriteBytes(bytes: Iterable<number>, flush: boolean) {
    const output: number[] = [];
    for (const byte of bytes) {
      if (this.pending.length === 0 && byte !== ESC) {
        output.push(byte);
        continue;
      }
      this.pending.push(byte);
      this.drainCsi(output);
    }
    if (flush) output.push(...this.flush());
    return output;
  }

  private detectCodex(bytes: Iterable<number>) {
    for (const byte of bytes) {
      if (byte === CODEX_BANNER[this.bannerMatch]) {
        this.bannerMatch += 1;
      } else {
        this.bannerMatch = byte === CODEX_BANNER[0] ? 1 : 0;
      }
      if (this.bannerMatch !== CODEX_BANNER.length) continue;
      this.enableCodexStyles();
      return;
    }
  }

  flush() {
    const output = this.pending;
    this.pending = [];
    return output;
  }

  private drainCsi(output: number[]) {
    if (this.pending.length === 2 && this.pending[1] !== CSI) {
      output.push(...this.flush());
      return;
    }
    const final = this.pending.at(-1)!;
    if (this.pending.length > 2 && isCsiFinal(final)) {
      output.push(...this.rewriteCsi(this.pending));
      this.pending = [];
    } else if (this.pending.length > MAX_CSI_BYTES) {
      output.push(...this.flush());
    }
  }

  private rewriteCsi(sequence: number[]) {
    if (leavesAlternateScreen(sequence) && !this.pinnedCodexStyles) {
      this.rewriteCodexStyles = false;
    }
    if (sequence.at(-1) !== SGR) return sequence;
    const body = decoder.decode(Uint8Array.from(sequence.slice(2, -1)));
    const target = this.transparent ? null : this.target;
    const rewritten = rewriteSgr(body, {
      sources: this.sources,
      target,
      transparent: this.transparent,
      rewriteCodexStyles: this.rewriteCodexStyles,
    });
    if (rewritten === null) return [];
    return Array.from(encoder.encode(`\x1b[${rewritten}m`));
  }

  private remember(background: Rgb) {
    if (!this.sources.some((source) => sameRgb(source, background))) {
      this.sources.push(background);
    }
  }
}

type Rgb = [number, number, number];
type RewriteContext = {
  sources: Rgb[];
  target: Rgb | null;
  transparent: boolean;
  rewriteCodexStyles: boolean;
};

function composerBackground(background: string): Rgb {
  const [red, green, blue] = parseHex(background);
  const light = 0.299 * red + 0.587 * green + 0.114 * blue > 128;
  const top = light ? 0 : 255;
  const alpha = light ? 0.04 : 0.12;
  const blend = (channel: number) => Math.trunc(top * alpha + channel * (1 - alpha));
  return [blend(red), blend(green), blend(blue)];
}

function parseHex(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!match) throw new Error(`terminal background must be #rrggbb: ${value}`);
  return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)];
}

function rewriteSgr(body: string, context: RewriteContext) {
  const params = body.split(";");
  for (let index = 0; index < params.length;) {
    index = rewriteParam(params, index, context);
  }
  return params.length > 0 ? params.join(";") : null;
}

function rewriteParam(params: string[], index: number, context: RewriteContext) {
  if (context.rewriteCodexStyles) {
    const colon = rewriteColonBackground(params[index], context);
    if (colon !== params[index]) {
      params[index] = colon;
      return index + 1;
    }

    const rgb = readTrueColorBackground(params, index);
    if (rgb) return rewriteTrueColor(params, index, { ...context, rgb });

    const indexed = readIndexedBackground(params, index);
    if (indexed !== null) return rewriteIndexed(params, index, {
      color: indexed,
      transparent: context.transparent,
    });
  }

  const extendedColorLength = readExtendedColorLength(params, index);
  if (extendedColorLength) return index + extendedColorLength;

  /* xterm WebGL 0.19 会把透明默认背景上的 dim 单元格栅格化成不透明底块。
     Codex 用 dim 画欢迎卡片、提示和 placeholder，所以整片空格也会变白。
     这里删除参数而不是改成 22：22 会连同同一序列里的 bold 一起关闭。 */
  if (context.transparent && params[index] === "2") {
    params.splice(index, 1);
    return index;
  }
  if (!context.rewriteCodexStyles) return index + 1;
  if (context.transparent && params[index] === "7") params[index] = INVERSE_OFF;
  if (context.transparent && NEUTRAL_ANSI_BACKGROUNDS.has(params[index])) {
    params[index] = DEFAULT_BACKGROUND;
  }
  return index + 1;
}

function rewriteTrueColor(
  params: string[],
  index: number,
  context: RewriteContext & { rgb: Rgb },
) {
  const known = context.sources.some((source) => sameRgb(source, context.rgb));
  if (!known && !(context.transparent && isNeutral(context.rgb))) return index + 5;
  if (!context.target) {
    params.splice(index, 5, DEFAULT_BACKGROUND);
    return index + 1;
  }
  params.splice(index + 2, 3, ...context.target.map(String));
  return index + 5;
}

function rewriteIndexed(
  params: string[],
  index: number,
  context: { color: number; transparent: boolean },
) {
  if (!context.transparent || !isNeutralIndex(context.color)) return index + 3;
  params.splice(index, 3, DEFAULT_BACKGROUND);
  return index + 1;
}

function readTrueColorBackground(params: string[], index: number): Rgb | null {
  if (params[index] !== "48" || params[index + 1] !== "2") return null;
  const rgb = params.slice(index + 2, index + 5).map(Number);
  return rgb.length === 3 && rgb.every(isByte) ? rgb as Rgb : null;
}

function readIndexedBackground(params: string[], index: number) {
  if (params[index] !== "48" || params[index + 1] !== "5") return null;
  const value = Number(params[index + 2]);
  return isByte(value) ? value : null;
}

function readExtendedColorLength(params: string[], index: number) {
  if (!["38", "48", "58"].includes(params[index])) return 0;
  if (params[index + 1] === "2") return params.length - index >= 5 ? 5 : 0;
  if (params[index + 1] === "5") return params.length - index >= 3 ? 3 : 0;
  return 0;
}

function rewriteColonBackground(param: string, context: RewriteContext) {
  const parts = param.split(":");
  if (parts[0] !== "48") return param;
  if (parts[1] === "5") {
    const indexed = Number(parts.at(-1));
    return context.transparent && isByte(indexed) && isNeutralIndex(indexed)
      ? DEFAULT_BACKGROUND
      : param;
  }
  if (parts[1] !== "2" || parts.length < 5) return param;
  const rgb = parts.slice(-3).map(Number);
  if (!rgb.every(isByte)) return param;
  const known = context.sources.some((source) => sameRgb(source, rgb as Rgb));
  if (!known && !(context.transparent && isNeutral(rgb as Rgb))) return param;
  if (!context.target) return DEFAULT_BACKGROUND;
  parts.splice(-3, 3, ...context.target.map(String));
  return parts.join(":");
}

function isNeutral([red, green, blue]: Rgb) {
  return Math.max(red, green, blue) - Math.min(red, green, blue) <= MAX_NEUTRAL_CHROMA;
}

function isNeutralIndex(index: number) {
  if ([0, 7, 8, 15].includes(index) || index >= 232) return true;
  if (index < 16) return false;
  const cube = index - 16;
  const red = Math.floor(cube / 36);
  const green = Math.floor((cube % 36) / 6);
  const blue = cube % 6;
  return red === green && green === blue;
}

function isByte(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function isCsiFinal(byte: number) {
  return byte >= 0x40 && byte <= 0x7e;
}

function sameRgb(left: Rgb, right: Rgb) {
  return left.every((channel, index) => channel === right[index]);
}

function leavesAlternateScreen(sequence: number[]) {
  if (sequence.at(-1) !== DEC_PRIVATE_MODE_RESET) return false;
  const body = decoder.decode(Uint8Array.from(sequence.slice(2, -1)));
  return body.startsWith("?")
    && body.slice(1).split(";").some((mode) => ALT_SCREEN_MODES.has(mode));
}
