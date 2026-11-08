import type { Terminal } from "@xterm/xterm";
import type { TerminalChoice } from "./choice";

export interface ChoiceCell { foreground: string; background: string }
export interface ChoiceRow { text: string; cell: (column: number) => ChoiceCell | null }

/** OpenCode 2.2 uses horizontal buttons. The focused button shares the left border's color. */
export function parseOpencodeChoice(rows: readonly ChoiceRow[]): TerminalChoice | null {
  const text = rows.map(row => row.text).join("\n");
  if (!/⇆\s+select/.test(text) || !/enter\s+confirm/.test(text)) return null;
  let title = -1;
  for (let at = rows.length - 1; at >= 0; at--) {
    if (/^[\s┃│▎▏▌△]*Permission required\s*$/.test(rows[at].text)) { title = at; break; }
  }
  if (title < 0) return null;
  for (let at = rows.length - 1; at > title; at--) {
    const row = rows[at];
    const buttons = /\bAllow once\s+(?:(Always allow)\s+)?Reject\b/.exec(row.text);
    if (!buttons) continue;
    const border = /^[\s]*([┃│▎▏▌])/.exec(row.text);
    if (!border) return null;
    const accent = row.cell(border[0].length - 1)?.foreground;
    if (!accent) return null;
    const labels = buttons[1] ? ["Allow once", "Always allow", "Reject"] : ["Allow once", "Reject"];
    let selected = 0, from = buttons.index;
    for (const [index, label] of labels.entries()) {
      const column = row.text.indexOf(label, from);
      const cells = Array.from({ length: label.length }, (_, offset) => row.cell(column + offset));
      if (cells.some(cell => !cell || cell.background !== cells[0]?.background || cell.foreground !== cells[0]?.foreground)) return null;
      if (cells[0]?.background === accent) {
        if (selected) return null;
        selected = index + 1;
      }
      from = column + label.length;
    }
    if (!selected) return null;
    const question = "Permission required";
    const detail = rows.slice(title + 1, at).map(row => row.text.replace(/^[\s┃│▎▏▌]+/, "").trimEnd()).filter(Boolean).join("\n");
    return { question, detail, options: labels.map((label, index) => ({ index: index + 1, label })), selected,
      axis: "horizontal", signature: ["opencode", question, detail, ...labels].join("\u0000") };
  }
  return null;
}

export function readOpencodeChoice(terminal: Terminal): TerminalChoice | null {
  const rows: ChoiceRow[] = [], buffer = terminal.buffer.active;
  for (let y = 0; y < terminal.rows; y++) {
    const line = buffer.getLine(buffer.baseY + y);
    if (!line) continue;
    rows.push({ text: line.translateToString(true), cell(column) {
      const cell = line.getCell(column);
      if (!cell) return null;
      const foreground = `${cell.getFgColorMode()}:${cell.getFgColor()}`;
      const background = `${cell.getBgColorMode()}:${cell.getBgColor()}`;
      return cell.isInverse() ? { foreground: background, background: foreground } : { foreground, background };
    } });
  }
  return parseOpencodeChoice(rows);
}
