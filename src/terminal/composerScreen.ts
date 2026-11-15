import type { Terminal } from "@xterm/xterm";
import type { AgentKind } from "../agent/contracts";

/**
 * What the rendered composer shows right now.
 *
 * Only `empty` may release native input ownership; `unknown` keeps whatever the
 * host already believes, so an unreadable screen can never overwrite a draft.
 */
export type ComposerObservation = "empty" | "occupied" | "unknown";

/** 判定逻辑的最小屏幕投影：剥掉 xterm，测试才不需要 DOM。 */
export interface ObservedCell { chars: string; dim: boolean }
export interface ObservedRow { cells: readonly (ObservedCell | null)[] }

/** Codex 在输入框为空时才画的提示语；有内容时整行会被真实文字替换。 */
const CODEX_EMPTY_HINTS = new Set(["Ask Codex to do anything", "Ask a follow-up question"]);
/** 输入框始终在底部；再上面的 `›` 属于对话记录，不是可编辑位置。 */
const CODEX_SCAN_ROWS = 8;
const CODEX_PROMPT = /^([›»]) (.*)$/u;

export function observeComposer(
  rows: readonly ObservedRow[],
  agent: AgentKind | null,
  requireDim = true,
): ComposerObservation {
  // Claude 的输入区同样可以解析，但仓库还没有用真实屏幕验证过它的版式；
  // 认错会覆盖用户草稿，所以在验证前一律返回 unknown。
  if (agent !== "codex") return "unknown";
  const scanned = Math.min(rows.length, CODEX_SCAN_ROWS);
  for (let offset = 1; offset <= scanned; offset++) {
    const row = rows[rows.length - offset];
    const match = CODEX_PROMPT.exec(rowText(row));
    if (!match) continue;
    // 自下而上找到的第一行提示符就是当前输入框；其余都已提交成历史。
    const content = match[2].trim();
    const empty = CODEX_EMPTY_HINTS.has(content) && (!requireDim || dimAfter(row, 2));
    return empty ? "empty" : "occupied";
  }
  return "unknown";
}

export function readObservedComposer(
  terminal: Pick<Terminal, "rows"> & { buffer: Terminal["buffer"] },
  agent: AgentKind | null,
  requireDim = true,
): ComposerObservation {
  if (agent !== "codex") return "unknown";
  const active = terminal.buffer.active;
  const rows: ObservedRow[] = [];
  // 只回放最近几行：屏幕再大，输入框也不会上移到更早的位置。
  const first = Math.max(0, terminal.rows - CODEX_SCAN_ROWS);
  for (let y = first; y < terminal.rows; y++) {
    const line = active.getLine(active.baseY + y);
    if (!line) {
      rows.push({ cells: [] });
      continue;
    }
    const cells: (ObservedCell | null)[] = [];
    for (let x = 0; x < line.length; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getWidth() === 0) {
        cells.push(null);
        continue;
      }
      const chars = cell.getChars();
      cells.push({ chars: chars || " ", dim: cell.isDim() !== 0 });
    }
    rows.push({ cells });
  }
  return observeComposer(rows, agent, requireDim);
}

function rowText(row: ObservedRow) {
  let text = "";
  for (const cell of row.cells) if (cell) text += cell.chars;
  return text.trimEnd();
}

/** 从 `start` 开始所有可见字符都是暗色；空行不算证据。 */
function dimAfter(row: ObservedRow, start: number) {
  let seen = false;
  for (let x = start; x < row.cells.length; x++) {
    const cell = row.cells[x];
    if (!cell || !cell.chars.trim()) continue;
    seen = true;
    if (!cell.dim) return false;
  }
  return seen;
}
