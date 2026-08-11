import type { TerminalTheme } from "../theme/xtermTheme";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ESC = 0x1b;
const CSI = 0x5b;
const SGR = 0x6d;
const MAX_CSI_BYTES = 128;

/** Codex 会把启动时探测到的终端底色混成输入区背景，并在进程内永久缓存。 */
export class CodexThemeSync {
  private readonly sources: Rgb[] = [];
  private target: Rgb;
  private pending: number[] = [];

  constructor(theme: TerminalTheme) {
    this.target = composerBackground(theme.background);
    this.remember(this.target);
  }

  setTheme(theme: TerminalTheme) {
    this.target = composerBackground(theme.background);
    this.remember(this.target);
  }

  rewrite(bytes: Iterable<number>, flush = false) {
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
    if (sequence.at(-1) !== SGR) return sequence;
    const body = decoder.decode(Uint8Array.from(sequence.slice(2, -1)));
    const rewritten = rewriteBackground(body, this.sources, this.target);
    return Array.from(encoder.encode(`\x1b[${rewritten}m`));
  }

  private remember(background: Rgb) {
    if (!this.sources.some((source) => sameRgb(source, background))) {
      this.sources.push(background);
    }
  }
}

type Rgb = [number, number, number];

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

function rewriteBackground(body: string, sources: Rgb[], target: Rgb) {
  const params = body.split(";");
  for (let index = 0; index <= params.length - 5; index += 1) {
    if (sources.some((source) => matchesBackground(params, index, source))) {
      params.splice(index + 2, 3, ...target.map(String));
    }
  }
  return sources.reduce(
    (rewritten, source) => rewriteColonBackground(rewritten, source, target),
    params.join(";"),
  );
}

function matchesBackground(params: string[], index: number, [red, green, blue]: Rgb) {
  return params[index] === "48"
    && params[index + 1] === "2"
    && params[index + 2] === String(red)
    && params[index + 3] === String(green)
    && params[index + 4] === String(blue);
}

function rewriteColonBackground(body: string, source: Rgb, target: Rgb) {
  const sourceRgb = source.join(":");
  const targetRgb = target.join(":");
  return body
    .replaceAll(`48:2:${sourceRgb}`, `48:2:${targetRgb}`)
    .replaceAll(`48:2::${sourceRgb}`, `48:2::${targetRgb}`);
}

function isCsiFinal(byte: number) {
  return byte >= 0x40 && byte <= 0x7e;
}

function sameRgb(left: Rgb, right: Rgb) {
  return left.every((channel, index) => channel === right[index]);
}
