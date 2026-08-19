import type { IBuffer, IBufferLine, Terminal } from "@xterm/xterm";

export interface TerminalSearchMatch {
  line: number;
  column: number;
  length: number;
  text: string;
}

export interface TerminalSearchState {
  query: string;
  matches: TerminalSearchMatch[];
  activeIndex: number;
}

export class TerminalSearchController {
  private query = "";
  private matches: TerminalSearchMatch[] = [];
  private activeIndex = -1;

  constructor(private readonly terminal: Terminal) {}

  search(query: string): TerminalSearchState {
    this.query = query;
    this.matches = query ? scanBuffer(this.terminal, query) : [];
    this.activeIndex = this.matches.length > 0 ? 0 : -1;
    this.selectActive();
    return this.snapshot();
  }

  findNext(): TerminalSearchState {
    if (this.matches.length > 0) {
      this.activeIndex = (this.activeIndex + 1) % this.matches.length;
      this.selectActive();
    }
    return this.snapshot();
  }

  findPrevious(): TerminalSearchState {
    if (this.matches.length > 0) {
      this.activeIndex = (this.activeIndex - 1 + this.matches.length) % this.matches.length;
      this.selectActive();
    }
    return this.snapshot();
  }

  refresh() {
    return this.search(this.query);
  }

  clear() {
    this.query = "";
    this.matches = [];
    this.activeIndex = -1;
    this.terminal.clearSelection();
    return this.snapshot();
  }

  focus() {
    this.terminal.focus();
  }

  get state() {
    return this.snapshot();
  }

  private snapshot(): TerminalSearchState {
    return {
      query: this.query,
      matches: [...this.matches],
      activeIndex: this.activeIndex,
    };
  }

  private selectActive() {
    const match = this.matches[this.activeIndex];
    if (match) {
      this.terminal.scrollToLine(match.line);
      this.terminal.select(match.column, match.line, match.length);
    } else {
      this.terminal.clearSelection();
    }
  }
}

export function findTextMatches(text: string, query: string): Array<{ offset: number; length: number }> {
  if (!query) return [];
  const source = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const result: Array<{ offset: number; length: number }> = [];
  let offset = 0;
  while (offset <= source.length - needle.length) {
    const match = source.indexOf(needle, offset);
    if (match < 0) break;
    result.push({ offset: match, length: needle.length });
    offset = match + Math.max(needle.length, 1);
  }
  return result;
}

function scanBuffer(terminal: Terminal, query: string): TerminalSearchMatch[] {
  const matches: TerminalSearchMatch[] = [];
  const buffer = terminal.buffer.active;
  let lineNumber = 0;
  while (lineNumber < buffer.length) {
    const logicalLine = readLogicalLine(buffer, lineNumber, terminal.cols);
    for (const match of findTextMatches(logicalLine.text, query)) {
      const start = logicalLine.boundaries[match.offset];
      const end = logicalLine.boundaries[match.offset + match.length];
      if (!start || !end) continue;
      const length = selectionLength(start, end, terminal.cols);
      if (length <= 0) continue;
      matches.push({
        line: start.line,
        column: start.column,
        length,
        text: logicalLine.text.slice(match.offset, match.offset + match.length),
      });
    }
    lineNumber = logicalLine.nextLine;
  }
  return matches;
}

interface BufferPosition {
  line: number;
  column: number;
}

interface LogicalBufferLine {
  text: string;
  boundaries: BufferPosition[];
  nextLine: number;
}

/**
 * xterm 的 wrapped 行在逻辑上没有换行符。把它们拼起来后再匹配，
 * 同时保留每个 UTF-16 偏移对应的物理 cell 边界，才能正确选中跨行的结果。
 */
function readLogicalLine(buffer: IBuffer, startLine: number, cols: number): LogicalBufferLine {
  let text = "";
  const boundaries: BufferPosition[] = [];
  let lineNumber = startLine;

  while (lineNumber < buffer.length) {
    const line = buffer.getLine(lineNumber);
    if (!line) break;
    const next = buffer.getLine(lineNumber + 1);
    const wrapped = Boolean(next?.isWrapped);
    text += appendPhysicalLine(boundaries, line, lineNumber, wrapped, cols);
    lineNumber += 1;
    if (!wrapped) break;
  }

  return { text, boundaries, nextLine: Math.max(lineNumber, startLine + 1) };
}

interface MappedBufferLine extends IBufferLine {
  translateToString(
    trimRight?: boolean,
    startColumn?: number,
    endColumn?: number,
    outColumns?: number[],
  ): string;
}

function appendPhysicalLine(
  boundaries: BufferPosition[],
  line: IBufferLine,
  lineNumber: number,
  wrapped: boolean,
  cols: number,
): string {
  const columns: number[] = [];
  const mapped = line as MappedBufferLine;
  const text = mapped.translateToString(
    !wrapped,
    0,
    Math.min(line.length, cols),
    columns,
  );
  const first = { line: lineNumber, column: columns[0] ?? 0 };
  if (boundaries.length === 0) boundaries.push(first);
  else boundaries[boundaries.length - 1] = first;
  for (let offset = 1; offset <= text.length; offset += 1) {
    boundaries.push({ line: lineNumber, column: columns[offset] ?? columns.at(-1) ?? 0 });
  }
  return text;
}

function selectionLength(start: BufferPosition, end: BufferPosition, cols: number) {
  return (end.line - start.line) * cols + end.column - start.column;
}
