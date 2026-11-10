import type { ParsedInteraction } from "./interaction";
import { choiceFooterStart, RULE } from "./choiceSignals";

export const CODEX_QUEUED_HEADER = /^\s*• Queued follow-up inputs\s*$/u;
const COUNT = /^\? ([1-9]\d*) questions?(?: · \d+(?:m(?: \d+s)?|s))?$/u;
const OPEN = /^(?:shift\+←|⇧←)\s+to answer$/iu;

/** Recognize the collapsed TUI entry; historical bullet options are deliberately unused. */
export function codexQueuedQuestions(lines: string[], rawLines: string[]): Omit<ParsedInteraction, "signature" | "contextSignature"> | null {
  let header = lines.length - 1;
  while (header >= 0 && !CODEX_QUEUED_HEADER.test(lines[header])) header -= 1;
  if (header < 0 || /^\s*[>|]/u.test(rawLines[header] ?? "")) return null;
  let fenced = false;
  for (const line of rawLines.slice(0, header + 1)) if (/^\s*(?:```|~~~)/u.test(line)) fenced = !fenced;
  if (fenced) return null;
  const body = lines.slice(header + 1).map(line => line.trim()).filter(Boolean);
  const match = COUNT.exec(body[0] ?? "");
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null; // Expanded editor has no count row.
  const rest = body.slice(2).filter(line => !RULE.test(line));
  const composer = rest[0] ?? "";
  const emptyComposer = !composer || /^›(?:\s+Ask Codex to do anything)?\s*$/u.test(composer);
  // Unknown placeholders, extra queued inputs and multiline drafts stay in the terminal.
  const statusOnly = rest.slice(1).every(line => /^(?:.* · .* · ← for agents|\d+% context left.*|\? for shortcuts)$/u.test(line));
  const safe = OPEN.test(body[1] ?? "") && emptyComposer && statusOnly;
  const context = lines.slice(0, header).filter(line => !/\bto interrupt\)/iu.test(line)).map(line => line.trimEnd());
  while (context.length && !context.at(-1)?.trim()) context.pop();
  return { kind: safe ? "queued" : "unknown", question: "", detail: safe ? "" : lines.slice(header).join("\n").trim(),
    options: [], selected: null, selectedIndices: [], input: null, queue: { count: Number(match[1]) },
    queueContext: context.join("\n"), control: safe ? "open-questions" : "none" };
}

export function isCodexQuestionEditor(lines: string[]): boolean {
  const start = choiceFooterStart(lines);
  if (start < 0) return false;
  const footer = lines.slice(start).join(" ");
  return /(?:⌃\]|ctrl\+\])\s+skip/u.test(footer)
    && /(?:⇧→|shift\+→)\s+(?:main prompt|prev question)/u.test(footer);
}
