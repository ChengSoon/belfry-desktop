import { CHOICE_QUESTION } from "./activity";

/**
 * 从终端屏幕底部读出 Agent 的选择框：问题、补充内容（要执行的命令等）和选项。
 *
 * 信号来自 Claude Code / Codex 的界面文案，会随版本漂移。读不准就返回 null——
 * 宁可让用户去终端里自己选，也不能把一次误读变成替用户按下的一个选项。
 * 所以只认带选择光标的编号列表：光标在哪一项，才算得出该按几下方向键。
 */

export interface TerminalChoiceOption {
  /** 屏幕上的编号（从 1 起）。 */
  index: number;
  label: string;
}

export interface TerminalChoice {
  question: string;
  /** 问题和选项之间的内容：要执行的命令、要改的文件。最多几行。 */
  detail: string;
  options: TerminalChoiceOption[];
  /** 光标当前停在哪一项（编号）。 */
  selected: number;
  /** 同一个选择框读两遍应当一样；发按键前拿它确认屏幕没变。 */
  signature: string;
}

/** 选择框连同上方的命令可能有十几行；多读一些，比 activity 判定的 12 行宽。 */
export const CHOICE_TAIL_LINES = 30;
const MAX_DETAIL_LINES = 6;

const BORDER_LEFT = /^[\s│┃|╭╮╰╯─━]+/u;
const BORDER_RIGHT = /[\s│┃|╭╮╰╯─━]+$/u;
const OPTION = /^([❯›>▶]\s*)?(\d+)[.)]\s+(.+)$/u;
const RULE = /^[─━═\-\s]+$/u;

function clean(line: string) {
  return line.replace(BORDER_LEFT, "").replace(BORDER_RIGHT, "");
}

export function parseChoice(tail: string): TerminalChoice | null {
  const lines = tail.split("\n").map(clean);
  // 从底往上找最后一段编号选项：选择框总在屏幕底部，正文里的有序列表在它上面。
  let end = -1;
  for (let at = lines.length - 1; at >= 0; at--) {
    if (OPTION.test(lines[at])) { end = at; break; }
  }
  if (end < 0) return null;
  let start = end;
  for (let at = end - 1; at >= 0; at--) {
    if (OPTION.test(lines[at])) start = at;
    else if (lines[at].trim() !== "") break;
  }
  const options: TerminalChoiceOption[] = [];
  let selected = 0;
  for (const line of lines.slice(start, end + 1)) {
    const match = OPTION.exec(line);
    if (!match) continue;
    const index = Number(match[2]);
    options.push({ index, label: match[3].trim() });
    if (match[1]) selected = selected === 0 ? index : -1;
  }
  // 编号必须是 1、2、3…连续的，光标恰好一个：否则不是我们认得的选择框。
  const sequential = options.every((option, at) => option.index === at + 1);
  if (options.length < 2 || !sequential || selected <= 0) return null;

  let questionAt = -1;
  for (let at = start - 1; at >= Math.max(0, start - 1 - MAX_DETAIL_LINES * 2); at--) {
    if (CHOICE_QUESTION.test(lines[at])) { questionAt = at; break; }
  }
  if (questionAt < 0) {
    for (let at = start - 1; at >= 0; at--) {
      if (lines[at].trim() && !RULE.test(lines[at])) { questionAt = at; break; }
    }
  }
  if (questionAt < 0) return null;
  const question = lines[questionAt].trim();
  const detail = lines
    .slice(questionAt + 1, start)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() && !RULE.test(line))
    .slice(0, MAX_DETAIL_LINES)
    .join("\n");
  const signature = [question, detail, ...options.map((option) => `${option.index}.${option.label}`)].join("\u0000");
  return { question, detail, options, selected, signature };
}

/**
 * 选中第 `index` 项要发的按键：从光标位置按方向键挪过去，再回车。
 *
 * 不发数字键：Claude Code 认数字，Codex 的确认框未必认，方向键 + 回车两边都认。
 * 方向键的转义序列随终端模式变：应用光标模式下是 `ESC O B`，否则 `ESC [ B`。
 */
export function choiceKeys(choice: TerminalChoice, index: number, applicationCursor: boolean): string | null {
  if (!choice.options.some((option) => option.index === index)) return null;
  const delta = index - choice.selected;
  const prefix = applicationCursor ? "\u001bO" : "\u001b[";
  const arrow = `${prefix}${delta > 0 ? "B" : "A"}`;
  return arrow.repeat(Math.abs(delta)) + "\r";
}
