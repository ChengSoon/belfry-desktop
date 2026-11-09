import type { Terminal } from "@xterm/xterm";

export interface ScreenLine { text: string; isWrapped: boolean }

/** Only the live screen is read; scrolling through history cannot revive a request. */
export function readScreen(terminal: Terminal): ScreenLine[] {
  const buffer = terminal.buffer.active;
  const lines: ScreenLine[] = [];
  for (let y = 0; y < terminal.rows; y++) {
    const line = buffer.getLine(buffer.baseY + y);
    // Wrapped rows must retain trailing spaces: trimming them joins distinct words.
    if (line) lines.push({ text: line.translateToString(false), isWrapped: line.isWrapped });
  }
  return lines;
}

export function screenTail(lines: readonly ScreenLine[], maxLines: number): string {
  const logical: string[] = [];
  for (const line of lines) {
    if (line.isWrapped && logical.length > 0) logical[logical.length - 1] += line.text;
    else logical.push(line.text);
  }
  while (logical.length && !logical[logical.length - 1].trim()) logical.pop();
  return logical.slice(Math.max(0, logical.length - maxLines)).map(line => line.trimEnd()).join("\n");
}

export function readScreenTail(terminal: Terminal, lines: number): string {
  return screenTail(readScreen(terminal), lines);
}
