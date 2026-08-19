import type {
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";

const URL_PATTERN = /https?:\/\/[^\s<>'"`]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、＞》」』】]+$/u;

export function registerHttpLinkProvider(terminal: Terminal) {
  return terminal.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const line = terminal.buffer.active.getLine(lineNumber - 1);
      callback(line ? linksForLine(line, lineNumber) : undefined);
    },
  } satisfies ILinkProvider);
}

export function findHttpUrls(text: string) {
  return [...text.matchAll(URL_PATTERN)].flatMap((match) => {
    const value = trimUrl(match[0]);
    return value ? [{ url: value, offset: match.index ?? 0 }] : [];
  });
}

function linksForLine(line: IBufferLine, lineNumber: number): ILink[] {
  const text = line.translateToString(true);
  const cells = cellMap(line);
  return findHttpUrls(text).flatMap(({ url, offset }) => {
    const start = cellAtTextOffset(cells, offset);
    const end = cellAtTextOffset(cells, offset + url.length);
    if (start === undefined || end === undefined || end <= start) return [];
    const range: IBufferRange = {
      start: { x: start + 1, y: lineNumber },
      end: { x: end, y: lineNumber },
    };
    return [{
      text: url,
      range,
      decorations: { pointerCursor: true, underline: true },
      activate: (_event, value) => openHttpUrl(value),
    }];
  });
}

interface CellOffset {
  cell: number;
  start: number;
  end: number;
}

function cellMap(line: IBufferLine): CellOffset[] {
  const result: CellOffset[] = [];
  let offset = 0;
  for (let cell = 0; cell < line.length; cell += 1) {
    const value = line.getCell(cell);
    if (!value || value.getWidth() === 0) continue;
    const chars = value.getChars() || " ";
    result.push({ cell, start: offset, end: offset + chars.length });
    offset += chars.length;
  }
  return result;
}

function cellAtTextOffset(cells: CellOffset[], offset: number) {
  if (offset <= 0) return cells[0]?.cell;
  const containing = cells.find((entry) => offset >= entry.start && offset < entry.end);
  if (containing) return containing.cell;
  const last = cells[cells.length - 1];
  if (!last || offset < last.end) return undefined;
  return last.cell + 1;
}

function trimUrl(value: string) {
  let trimmed = value.replace(TRAILING_PUNCTUATION, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]]) {
    while (trimmed.endsWith(close) && count(trimmed, close) > count(trimmed, open)) {
      trimmed = trimmed.slice(0, -1);
    }
  }
  return trimmed;
}

function count(value: string, needle: string) {
  return [...value].filter((character) => character === needle).length;
}

function openHttpUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    window.open(url.href, "_blank", "noopener,noreferrer");
  } catch {
    // A link can become invalid while the buffer is being rewritten; ignore it.
  }
}
