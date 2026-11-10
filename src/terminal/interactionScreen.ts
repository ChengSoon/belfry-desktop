import type { Terminal } from "@xterm/xterm";
import type { AgentKind } from "../agent/contracts";
import type { ParsedInteraction } from "./interaction";
import { parseInteractionText } from "./choiceParser";
import { cleanChoiceLine, CONFIRM_TAIL } from "./choiceSignals";
import { CODEX_QUEUED_HEADER } from "./codexQueuedQuestions";
import { readOpencodeChoice } from "./opencodeChoice";
import { readScreenTail } from "./screen";

export function readInteractionScreen(terminal: Terminal, agent: AgentKind | null): ParsedInteraction | null {
  if (agent === "opencode") {
    const choice = readOpencodeChoice(terminal);
    if (choice) return { ...choice, kind: "confirmation", control: "arrows", selectedIndices: [],
      input: null, contextSignature: choice.signature, optionsComplete: true };
  }
  const parsed = parseInteractionText(readScreenTail(terminal, terminal.rows), agent);
  if (parsed?.queue) {
    const buffer = terminal.buffer.active;
    for (let y = terminal.rows - 1; y >= 0; y--) {
      if (!CODEX_QUEUED_HEADER.test(cleanChoiceLine(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? ""))) continue;
      // Bind the entry to its live buffer location, not to question count alone.
      parsed.signature = JSON.stringify([parsed.signature, buffer.baseY + y]);
      break;
    }
  }
  if (parsed?.control === "yes-no") {
    const buffer = terminal.buffer.active;
    const cursorLine = buffer.getLine(buffer.baseY + buffer.cursorY)?.translateToString(true) ?? "";
    // A printed example followed by a new empty input line must not become y/n buttons.
    if (!CONFIRM_TAIL.test(cursorLine)) return null;
  }
  return parsed;
}
