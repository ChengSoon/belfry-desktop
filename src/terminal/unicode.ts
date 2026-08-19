import type { IUnicodeVersionProvider, Terminal } from "@xterm/xterm";

type CellWidth = 0 | 1 | 2;
type Range = readonly [number, number];

const STATE_NONE = 0;
const STATE_ZWJ = 1;
const STATE_REGIONAL = 2;
const STATE_REGIONAL_PAIR = 3;

const ZERO_WIDTH_RANGES: Range[] = [
  [0x0300, 0x036f],
  [0x0483, 0x0489],
  [0x0591, 0x05bd],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x06d6, 0x06ed],
  [0x0900, 0x0902],
  [0x093a, 0x094d],
  [0x0e31, 0x0e4e],
  [0x1160, 0x11ff],
  [0x1ab0, 0x1aff],
  [0x1dc0, 0x1dff],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x206f],
  [0x20d0, 0x20ff],
  [0x302a, 0x302f],
  [0x3099, 0x309a],
  [0xfe00, 0xfe0f],
  [0xfe20, 0xfe2f],
  [0xe0100, 0xe01ef],
];

const WIDE_RANGES: Range[] = [
  [0x1100, 0x115f],
  [0x2329, 0x232a],
  [0x2e80, 0x303e],
  [0x3040, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff01, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b2ff],
  [0x1f000, 0x1faff],
  [0x20000, 0x3fffd],
];

const MARK = /\p{Mark}/u;

export class Unicode11Provider implements IUnicodeVersionProvider {
  readonly version = "11";

  wcwidth(codepoint: number): CellWidth {
    if (codepoint === 0 || codepoint < 0x20 || (codepoint >= 0x7f && codepoint < 0xa0)) return 0;
    if (isZeroWidth(codepoint)) return 0;
    if (inRanges(codepoint, WIDE_RANGES)) return 2;
    return 1;
  }

  charProperties(codepoint: number, preceding: number): number {
    const precedingWidth = extractWidth(preceding);
    const precedingState = extractState(preceding);
    const width = this.wcwidth(codepoint);

    if (codepoint === 0x200d) {
      return createProperty(STATE_ZWJ, precedingWidth || 1, preceding !== 0);
    }
    if (isRegionalIndicator(codepoint)) {
      const joinsPair = precedingState === STATE_REGIONAL;
      return createProperty(joinsPair ? STATE_REGIONAL_PAIR : STATE_REGIONAL, 2, joinsPair);
    }
    if (precedingState === STATE_ZWJ && width > 0) {
      return createProperty(STATE_NONE, Math.max(width, precedingWidth) as 1 | 2, true);
    }
    if (width === 0 && preceding !== 0 && precedingWidth > 0) {
      return createProperty(precedingState, precedingWidth, true);
    }
    return createProperty(STATE_NONE, width, false);
  }
}

export function configureUnicode(terminal: Terminal) {
  if (!terminal.unicode.versions.includes("11")) {
    terminal.unicode.register(new Unicode11Provider());
  }
  terminal.unicode.activeVersion = "11";
}

/** 与 xterm UnicodeService 相同的累加规则，供单测覆盖组合序列。 */
export function unicodeStringWidth(value: string, provider = new Unicode11Provider()): number {
  let result = 0;
  let preceding = 0;
  for (const character of value) {
    const properties = provider.charProperties(character.codePointAt(0) ?? 0, preceding);
    let width = extractWidth(properties);
    if (shouldJoin(properties)) width -= extractWidth(preceding);
    result += width;
    preceding = properties;
  }
  return result;
}

function isZeroWidth(codepoint: number) {
  if (codepoint === 0x200d || (codepoint >= 0x1f3fb && codepoint <= 0x1f3ff)) return true;
  if (inRanges(codepoint, ZERO_WIDTH_RANGES)) return true;
  return MARK.test(String.fromCodePoint(codepoint));
}

function isRegionalIndicator(codepoint: number) {
  return codepoint >= 0x1f1e6 && codepoint <= 0x1f1ff;
}

function inRanges(codepoint: number, ranges: Range[]) {
  return ranges.some(([start, end]) => codepoint >= start && codepoint <= end);
}

function createProperty(state: number, width: CellWidth, join: boolean) {
  return ((state & 0xffffff) << 3) | ((width & 3) << 1) | (join ? 1 : 0);
}

function extractState(properties: number) {
  return properties >> 3;
}

function extractWidth(properties: number): CellWidth {
  return ((properties >> 1) & 3) as CellWidth;
}

function shouldJoin(properties: number) {
  return (properties & 1) !== 0;
}
