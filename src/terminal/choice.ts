import type { AgentKind } from "../agent/contracts";
import type { Terminal } from "@xterm/xterm";
import { parseInteractionText } from "./choiceParser";
import { readScreenTail } from "./screen";
import { readOpencodeChoice } from "./opencodeChoice";

export interface TerminalChoiceOption {
  index: number;
  label: string;
  description?: string;
}

/** Legacy single-choice surface. New consumers use TerminalInteraction. */
export interface TerminalChoice {
  question: string;
  detail: string;
  options: TerminalChoiceOption[];
  selected: number;
  axis?: "horizontal";
  signature: string;
}

export const CHOICE_TAIL_LINES = 30;

export function readTerminalChoice(terminal: Terminal, agent?: AgentKind | null): TerminalChoice | null {
  if (agent === "opencode") return readOpencodeChoice(terminal);
  return parseChoice(readScreenTail(terminal, terminal.rows), agent);
}

export function parseChoice(tail: string, agent?: AgentKind | null): TerminalChoice | null {
  const parsed = parseInteractionText(tail, agent);
  if (!parsed || parsed.control !== "arrows" || parsed.selected === null) return null;
  const { question, detail, options, selected, axis, signature } = parsed;
  return { question, detail, options, selected, axis, signature };
}

/** Number shortcuts are not shared by all CLIs; navigate from the current cursor. */
export function choiceKeys(choice: TerminalChoice, index: number, applicationCursor: boolean): string | null {
  const target = choice.options.findIndex(option => option.index === index);
  const current = choice.options.findIndex(option => option.index === choice.selected);
  if (target < 0 || current < 0) return null;
  const delta = target - current;
  const prefix = applicationCursor ? "\u001bO" : "\u001b[";
  const arrow = `${prefix}${choice.axis === "horizontal" ? (delta > 0 ? "C" : "D") : (delta > 0 ? "B" : "A")}`;
  return arrow.repeat(Math.abs(delta)) + "\r";
}
