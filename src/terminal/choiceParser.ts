import type { AgentKind } from "../agent/contracts";
import type { TerminalChoiceOption } from "./choice";
import type { ParsedInteraction } from "./interaction";
import { CHECKBOX_OPTION, CHOICE_QUESTION, CONFIRM_TAIL, NUMBERED_OPTION, QUESTION_PAGE, RULE,
  cleanChoiceLine, hasDefaultSubmit, isChoiceFooter, isNormalComposer } from "./choiceSignals";
import { unicodeStringWidth } from "./unicode";

type Evidence = Omit<ParsedInteraction, "signature" | "contextSignature">;
const PROMPT_TITLE = /^(?:[▶❯›]\s*)?(?:Select (?:Model|Reasoning|a model)|Update Model Permissions|Configure Status Line|Choose (?:an option|a mode)|Where should the new conversation run|Submit with unanswered questions|Run this command|Write this file|Apply these edits|Stop this task|Ready to build with this plan|Approve\b|Permission required|Status line)/i;
const INPUT_PLACEHOLDER = /^(?:[›❯]\s*)?(Type your answer(?: \(optional\))?|Add notes)$/i;

function finish(value: Evidence): ParsedInteraction {
  const contextSignature = JSON.stringify([value.kind, value.question, value.detail, value.options,
    value.control, value.axis, value.answers, value.input?.label, value.optionsComplete]);
  return { ...value, contextSignature, signature: JSON.stringify([contextSignature, value.inputValue ?? "", value.input?.placeholder, value.input?.optional]) };
}

export function unknownInteraction(question: string, detail: string): ParsedInteraction {
  return finish({ kind: "unknown", question, detail, options: [], selected: null, selectedIndices: [],
    input: null, control: "none" });
}

/** Full live-screen text, not the scrollback or a fixed 12/30-line suffix. */
export function parseInteractionText(tail: string, agent?: AgentKind | null): ParsedInteraction | null {
  const lines = tail.split("\n").map(cleanChoiceLine);
  while (lines.length && !lines.at(-1)?.trim()) lines.pop();
  if (!lines.length) return null;
  const footerAt = lastIndex(lines, isChoiceFooter);
  const footer = footerAt < 0 ? "" : lines.slice(footerAt).join(" ");
  const lastOption = lastIndex(lines, line => NUMBERED_OPTION.test(line) || CHECKBOX_OPTION.test(line));
  let fenced = false;
  for (let at = 0; at < lines.length; at++) {
    if (/^\s*(?:```|~~~)/.test(lines[at])) fenced = !fenced;
    if (fenced && (at === lastOption || at === footerAt)) return null;
  }
  // A historical menu followed by an ordinary composer is not a live request.
  if (lines.slice(Math.max(lastOption + 1, footerAt + 1)).some(isNormalComposer)) return null;
  if (footerAt >= 0 && !/\bsubmit\b/.test(footer)
    && lines.slice(footerAt + 1).some(line => /\bto interrupt\)/i.test(line))) return null;

  const confirm = CONFIRM_TAIL.exec(lines.at(-1) ?? "");
  if (confirm) return finish({ kind: "confirmation", question: confirm[1].trim(), detail: "",
    options: [{ index: 1, label: confirm[2] }, { index: 2, label: confirm[3] }], selected: null,
    selectedIndices: [], input: null, control: "yes-no", answers: [confirm[2].toLowerCase(), confirm[3].toLowerCase()] });

  const selection = readSelection(lines, footerAt, footer, agent);
  // Codex question input can coexist with its numbered options (notes / Other).
  const input = agent === "codex" ? readCodexInput(lines, footerAt, footer, selection) : null;
  if (input) return input;
  if (selection) return selection;

  if (explicitWaiting(lines, footer, agent)) {
    const content = lines.slice(0, footerAt < 0 ? lines.length : footerAt);
    const { question, detail } = questionContext(content, content.length);
    return unknownInteraction(question, detail || content.map(line => line.trim()).filter(Boolean).join("\n"));
  }
  return null;
}

function explicitWaiting(lines: string[], footer: string, agent?: AgentKind | null) {
  const widget = lines.some(line => QUESTION_PAGE.test(line.trim()) || PROMPT_TITLE.test(line.trim())
    || CHOICE_QUESTION.test(line) || /^\s*[❯›▶●◉☐☑]\s*\S/u.test(line));
  if (widget && footer && /\b(?:submit|confirm|select|toggle|save)\b|确认|提交|选择/i.test(footer)) return true;
  if (agent === "codex" && /(?:⌃\]|ctrl\+\])\s+skip/u.test(footer) && lines.some(line => INPUT_PLACEHOLDER.test(line.trim()))) return true;
  if (agent === "opencode" && /⇆\s+select/.test(footer) && lines.some(line => /Permission required/.test(line))) return true;
  if (agent === "antigravity" && lines.some(line => /Yes, (?:approve|proceed|elevate|run command|allow access)/.test(line))
    && lines.some(line => /No, (?:deny|reject|cancel)/.test(line))) return true;
  // An incomplete visible TUI is still actionable in its terminal. Bare prose is not.
  const cursor = lines.some(line => /^\s*[❯›▶]\s*(?:\d+[.)]|\[[ xX✓]\])\s/u.test(line));
  return cursor && (lines.some(line => QUESTION_PAGE.test(line.trim()) || PROMPT_TITLE.test(line.trim()) || CHOICE_QUESTION.test(line)));
}

interface RowOption extends TerminalChoiceOption { labelColumn: number; descriptionColumn?: number }

function readSelection(lines: string[], footerAt: number, footer: string, agent?: AgentKind | null): ParsedInteraction | null {
  const end = lastIndex(lines, line => NUMBERED_OPTION.test(line) || CHECKBOX_OPTION.test(line));
  if (end < 0) return null;
  const checkbox = CHECKBOX_OPTION.test(lines[end]);
  const pattern = checkbox ? CHECKBOX_OPTION : NUMBERED_OPTION;
  const last = pattern.exec(lines[end])!;
  const minColumn = unicodeStringWidth(lines[end].slice(0, lines[end].length - last[4].length));
  let start = end;
  for (let at = end - 1; at >= 0; at--) {
    const line = lines[at];
    if (pattern.test(line)) { start = at; continue; }
    if (!line.trim() || RULE.test(line) || /^[↑↓]$/.test(line.trim())) continue;
    if (leadingSpaces(line) >= minColumn) continue;
    break;
  }
  const rows: RowOption[] = [];
  let selected: number | null = null, cursorCount = 0;
  const selectedIndices: number[] = [];
  let unsafe = false;
  for (let at = start; at < (footerAt > end ? footerAt : lines.length); at++) {
    const line = lines[at], match = pattern.exec(line);
    if (match) {
      const index = checkbox ? rows.length + 1 : Number(match[3]);
      const labelColumn = unicodeStringWidth(line.slice(0, line.length - match[4].length));
      const row = splitOption(match[4], labelColumn, index);
      rows.push(row);
      if (match[2]) { selected = index; cursorCount += 1; }
      if (checkbox && match[3].trim()) selectedIndices.push(index);
      continue;
    }
    if (!line.trim() || RULE.test(line) || /^[↑↓]$/.test(line.trim())) continue;
    if (INPUT_PLACEHOLDER.test(line.trim()) || /^\s*[›❯]\s/.test(line)) break;
    if (isChoiceFooter(line)) break;
    const row = rows.at(-1);
    if (row && leadingSpaces(line) >= row.labelColumn) appendContinuation(row, line);
    // Checkbox menus may show a preview of checked labels above their footer.
    else if (at <= end || !checkbox) unsafe = true;
  }
  const options = rows.map(({ index, label, description }) => ({ index, label, ...(description ? { description } : {}) }));
  const context = questionContext(lines, start);
  const sequential = options.every((option, at) => Number.isSafeInteger(option.index) && option.index > 0
    && (at === 0 || option.index === options[at - 1].index + 1));
  const strongCursor = rows.length && lines.slice(start, end + 1).some(line => /^\s*[❯›▶]/u.test(line));
  if (!strongCursor) return null; // Markdown quote marker '>' is not TUI evidence.
  if (rows.length < 1 || cursorCount !== 1 || !sequential || !context.question) return null;
  const page = /\boption\s+\d+\/(\d+)/i.exec(footer);
  const optionsComplete = options[0].index === 1 && (!page || Number(page[1]) === options.length)
    && !lines.slice(Math.max(0, start - 1), footerAt < 0 ? lines.length : footerAt).some(line => /^[↑↓]$/.test(line.trim()));
  if (rows.length < 2 && !page && !footer) return null;
  if (unsafe || /^(?:\$|Reason:|Permission rule:)/.test(context.question)
    || lines.slice(0, start).some(line => /\[(?:…|\.{3})\s*\d+\s+lines?\]/i.test(line))
    || options.some(option => /\(disabled\)|\(unavailable\)|…\s*$/i.test(option.label))
    || (footer && !hasDefaultSubmit(footer)) || (checkbox && (!optionsComplete
      || !lines.slice(0, start).some(line => /^\s*Type to search\s*$/i.test(line))
      || !/space\s+(?:to\s+)?toggle|空格\s*切换/i.test(footer)))) {
    return unknownInteraction(context.question, [...[context.detail].filter(Boolean), ...lines.slice(start).map(line => line.trimEnd())].join("\n"));
  }
  // Non-default / partially visible checkbox state cannot be reconstructed safely.
  if (checkbox && agent !== "codex") return unknownInteraction(context.question, lines.slice(start).join("\n"));
  const kind = checkbox ? "multiple" : CHOICE_QUESTION.test(context.question) || /^(?:Submit with unanswered|[▶❯›]?\s*(?:Run this command|Write this file|Apply these edits))/i.test(context.question)
    ? "confirmation" : "single";
  return finish({ ...context, kind, options, selected, selectedIndices, input: null,
    control: checkbox ? "checkboxes" : "arrows", optionsComplete });
}

function leadingSpaces(line: string) { return /^\s*/.exec(line)![0].length; }

function lastIndex(lines: string[], predicate: (line: string, index: number) => boolean) {
  for (let at = lines.length - 1; at >= 0; at--) if (predicate(lines[at], at)) return at;
  return -1;
}

function splitOption(body: string, labelColumn: number, index: number): RowOption {
  const columns = /^(\S(?:.*?\S)?)(\s{2,})(\S.*)$/.exec(body);
  if (!columns) return { index, label: body.trim(), labelColumn };
  return { index, label: columns[1], description: columns[3].trim(), labelColumn,
    descriptionColumn: labelColumn + unicodeStringWidth(columns[1] + columns[2]) };
}

/** Ratatui wraps both columns itself; xterm's isWrapped alone cannot join these rows. */
function appendContinuation(row: RowOption, line: string) {
  if (row.descriptionColumn !== undefined) {
    const at = offsetAtColumn(line, row.descriptionColumn);
    const label = line.slice(0, at).trim(), description = line.slice(at).trim();
    if (label) row.label += `\n${label}`;
    if (description) row.description = [row.description, description].filter(Boolean).join("\n");
  } else {
    const indent = leadingSpaces(line);
    if (indent > row.labelColumn + 1) {
      row.descriptionColumn = indent;
      row.description = line.trim();
    } else row.label += `\n${line.trim()}`;
  }
}

function offsetAtColumn(line: string, column: number) {
  for (let at = 0; at < line.length; at++) if (unicodeStringWidth(line.slice(0, at)) >= column) return at;
  return line.length;
}

function questionContext(lines: string[], start: number): { question: string; detail: string } {
  const before = lines.slice(0, start);
  let questionAt = lastIndex(before, line => QUESTION_PAGE.test(line.trim()));
  let page = "";
  if (questionAt >= 0) {
    page = before[questionAt].trim();
    questionAt += 1;
    while (questionAt < start && !before[questionAt].trim()) questionAt += 1;
  } else questionAt = lastIndex(before, line => CHOICE_QUESTION.test(line) || PROMPT_TITLE.test(line.trim()));
  if (questionAt < 0) {
    questionAt = start - 1;
    while (questionAt >= 0 && (!before[questionAt].trim() || RULE.test(before[questionAt]) || /^[↑↓]$/.test(before[questionAt].trim()))) questionAt -= 1;
    while (questionAt > 0 && before[questionAt - 1].trim() && !RULE.test(before[questionAt - 1])) questionAt -= 1;
  }
  if (questionAt < 0 || questionAt >= start) return { question: "", detail: "" };
  let questionEnd = questionAt + 1;
  while (questionEnd < start && before[questionEnd].trim() && !RULE.test(before[questionEnd]) && !/^(?:\$ |Reason:|Permission rule:)/.test(before[questionEnd].trim())) questionEnd += 1;
  const question = before.slice(questionAt, questionEnd).map(line => line.trim()).join("\n");
  const detail = before.slice(questionEnd).filter(line => line.trim() && !RULE.test(line)).map(line => line.trimEnd());
  // Claude prints the command before its final permission question.
  const commandHeader = lastIndex(before, (line, at) => at < questionAt && /^\s*(?:Bash command|Edit file|Write file)\s*$/i.test(line));
  if (commandHeader >= 0) detail.unshift(...before.slice(commandHeader, questionAt).filter(line => line.trim() && !RULE.test(line)).map(line => line.trim()));
  const indent = detail.length ? Math.min(...detail.map(leadingSpaces)) : 0;
  return { question, detail: [page, ...detail.map(line => line.slice(indent))].filter(Boolean).join("\n") };
}

function readCodexInput(lines: string[], footerAt: number, footer: string, selection: ParsedInteraction | null): ParsedInteraction | null {
  if (footerAt < 0 || !/\bsubmit(?: answer)?\b/.test(footer)) return null;
  if (selection?.kind === "unknown") return null;
  const questionPage = lines.some(line => QUESTION_PAGE.test(line.trim()));
  const asyncQuestion = /(?:⌃\]|ctrl\+\])\s+skip/u.test(footer);
  if (!questionPage && !asyncQuestion) return null;
  let inputAt = lastIndex(lines, (line, at) => at < footerAt && INPUT_PLACEHOLDER.test(line.trim()));
  let inputOption: number | null = null;
  // AsyncQuestions always appends its editable Other slot after the named options.
  // Once typing starts, that row contains the draft rather than the word "Other".
  if (inputAt < 0 && selection?.optionsComplete && selection.selected === selection.options.at(-1)?.index && asyncQuestion) {
    inputAt = lastIndex(lines, line => /^\s*›\s*\d+[.)]\s+/.test(line));
    inputOption = selection.selected;
  }
  if (inputAt < 0 && (!selection || /\bclear notes\b/.test(footer))) {
    inputAt = lastIndex(lines, (line, at) => at < footerAt && /^\s*›\s+(?!\d+[.)])/.test(line));
  }
  if (inputAt < 0 && !selection && asyncQuestion) {
    inputAt = footerAt - 1;
    while (inputAt >= 0 && !lines[inputAt].trim()) inputAt -= 1;
    while (inputAt > 0 && lines[inputAt - 1].trim()) inputAt -= 1;
  }
  if (inputAt < 0) return null;
  const context = selection ? { question: selection.question, detail: selection.detail } : questionContext(lines, inputAt);
  if (!context.question || !hasDefaultSubmit(footer)) return unknownInteraction(context.question, lines.slice(inputAt).join("\n"));
  const raw = lines[inputAt].trim().replace(/^[›❯]\s*(?:\d+[.)]\s*)?/, "");
  const otherPlaceholder = /^\s*[›❯]\s*\d+[.)]\s+Other(?: \(write an answer\))?\s*$/.test(lines[inputAt]);
  const placeholder = INPUT_PLACEHOLDER.test(raw) || otherPlaceholder ? raw : "";
  const inputValue = placeholder ? "" : [raw, ...lines.slice(inputAt + 1, footerAt)].map(line => line.trimEnd()).join("\n").trim();
  return finish({ ...context, kind: "input", options: selection?.options.filter(option => option.index !== inputOption) ?? [], selected: selection?.selected ?? null,
    selectedIndices: [], input: { label: "", placeholder: placeholder || "Type your answer", optional: /\(optional\)/.test(placeholder) }, control: "text", inputValue });
}
