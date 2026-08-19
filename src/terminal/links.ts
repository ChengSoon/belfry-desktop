import type {
  IBufferLine,
  IBufferRange,
  ILink,
  ILinkProvider,
  Terminal,
} from "@xterm/xterm";

const URL_PATTERN = /https?:\/\/[^\s<>'"`]+/gi;
const TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、＞》」』】]+$/u;
const FILE_TOKEN_PATTERN = /\S+/gu;
const FILE_EXTENSIONS = new Set([
  "bash", "c", "cc", "cjs", "cpp", "css", "fish", "go", "h", "hh", "hpp", "htm",
  "html", "ini", "java", "js", "json", "jsx", "less", "log", "mjs", "md", "mdx", "py",
  "rs", "sass", "scss", "sh", "sql", "svelte", "toml", "ts", "tsx", "txt", "vue", "xml",
  "yaml", "yml", "zsh",
]);

export interface FilePathMatch {
  path: string;
  line: number | null;
  column: number | null;
  text: string;
  offset: number;
}

export function registerHttpLinkProvider(terminal: Terminal) {
  return terminal.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const line = terminal.buffer.active.getLine(lineNumber - 1);
      callback(line ? linksForLine(line, lineNumber) : undefined);
    },
  } satisfies ILinkProvider);
}

export function registerFileLinkProvider(
  terminal: Terminal,
  onOpenFile: (path: string, line: number | null) => void,
) {
  return terminal.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const line = terminal.buffer.active.getLine(lineNumber - 1);
      callback(line ? fileLinksForLine(line, lineNumber, onOpenFile) : undefined);
    },
  } satisfies ILinkProvider);
}

export function findHttpUrls(text: string) {
  return [...text.matchAll(URL_PATTERN)].flatMap((match) => {
    const value = trimUrl(match[0]);
    return value ? [{ url: value, offset: match.index ?? 0 }] : [];
  });
}

export function findFilePaths(text: string): FilePathMatch[] {
  return [...text.matchAll(FILE_TOKEN_PATTERN)].flatMap((match) => {
    const raw = match[0];
    const trimmed = trimFileToken(raw);
    if (!trimmed) return [];
    const parsed = parseFilePath(trimmed.value);
    if (!parsed) return [];
    return [{
      ...parsed,
      text: trimmed.value,
      offset: (match.index ?? 0) + trimmed.start,
    }];
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

function fileLinksForLine(
  line: IBufferLine,
  lineNumber: number,
  onOpenFile: (path: string, line: number | null) => void,
): ILink[] {
  const text = line.translateToString(true);
  const cells = cellMap(line);
  return findFilePaths(text).flatMap((match) => {
    const start = cellAtTextOffset(cells, match.offset);
    const end = cellAtTextOffset(cells, match.offset + match.text.length);
    if (start === undefined || end === undefined || end <= start) return [];
    return [{
      text: match.text,
      range: {
        start: { x: start + 1, y: lineNumber },
        end: { x: end, y: lineNumber },
      },
      decorations: { pointerCursor: true, underline: true },
      activate: () => onOpenFile(match.path, match.line),
    } satisfies ILink];
  });
}

function parseFilePath(value: string): Omit<FilePathMatch, "offset" | "text"> | null {
  if (/^(?:https?|ssh):\/\//iu.test(value)) return null;
  let path = value;
  let line: number | null = null;
  let column: number | null = null;
  const paren = path.match(/\((\d+)(?:,(\d+))?\)$/u);
  if (paren) {
    line = Number(paren[1]);
    column = paren[2] ? Number(paren[2]) : null;
    path = path.slice(0, paren.index ?? 0);
  } else {
    const suffix = path.match(/:(\d+)(?::(\d+))?$/u);
    if (suffix) {
      line = Number(suffix[1]);
      column = suffix[2] ? Number(suffix[2]) : null;
      path = path.slice(0, suffix.index ?? 0);
    }
  }
  path = trimTrailingPathPunctuation(path);
  if (!path || !looksLikeFilePath(path)) return null;
  return { path, line, column };
}

function looksLikeFilePath(value: string) {
  if (value.includes("://") && !/^file:\/\//iu.test(value)) return false;
  const withoutQuery = value.split(/[?#]/u, 1)[0];
  const extension = /\.([A-Za-z0-9]+)$/u.exec(withoutQuery)?.[1]?.toLowerCase();
  if (!extension || !FILE_EXTENSIONS.has(extension)) return false;
  return value.includes("/") || value.includes("\\") || /^[A-Za-z0-9_.-]+\.[A-Za-z0-9]+$/u.test(value);
}

function trimFileToken(value: string) {
  const leading = value.match(/^[([{<"'`]+/u)?.[0].length ?? 0;
  let candidate = value.slice(leading);
  candidate = trimTrailingPathPunctuation(candidate);
  return candidate ? { value: candidate, start: leading } : null;
}

function trimTrailingPathPunctuation(value: string) {
  let result = value.replace(/[.,!?;，。！？；、]+$/u, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"], ["<", ">"]]) {
    while (result.endsWith(close) && count(result, close) > count(result, open)) {
      result = result.slice(0, -1);
    }
  }
  return result;
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
