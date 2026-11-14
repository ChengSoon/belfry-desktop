import type { IDisposable, Terminal } from "@xterm/xterm";
import { usesTerminalStatus, type AgentKind } from "../../agent/contracts";
import type { HookSnapshot } from "../../agent/hooks/contracts";
import { terminalStatusFor } from "../../agent/programStatus";
import { choiceKeys, type TerminalChoice } from "../choice";
import { unknownInteraction } from "../choiceParser";
import type { InteractionWrite, InteractionWriteGuard, ParsedInteraction, TerminalInteraction, TerminalInteractionAnswer, TerminalInteractionResult } from "../interaction";
import { readInteractionScreen } from "../interactionScreen";

interface Ports {
  terminal: Terminal;
  agent: AgentKind | null;
  session: () => string | null;
  scope?: () => string | null;
  outputSettled: () => boolean;
  waitingReason: () => string | null;
  programStatus?: () => HookSnapshot | null;
  write: (request: InteractionWrite) => Promise<TerminalInteractionResult>;
  finishInteraction?: (sessionId: string, guard: InteractionWriteGuard, readySequence: number) => Promise<boolean>;
}

interface Request {
  id: string;
  sessionId: string;
  scope: string;
  identity: string;
  parsed: ParsedInteraction;
  state: TerminalInteraction["state"];
}

interface Completion {
  sessionId: string;
  identity: string;
  guard: InteractionWriteGuard;
  lastReadySequence?: number;
}

/** Owns request generations and consumed answers for a single mounted terminal. */
export class TerminalInteractions {
  private readonly instance = crypto.randomUUID();
  private readonly output: IDisposable;
  private generation = 0;
  private current: Request | null = null;
  private inFlight: Request | null = null;
  private completion: Completion | null = null;
  private disposed = false;

  constructor(private readonly ports: Ports) {
    // Observe disappearance even when the room is hidden / no UI is polling.
    this.output = ports.terminal.onWriteParsed(() => this.observe());
  }

  read(): TerminalInteraction | null {
    const request = this.observe();
    if (!request) return null;
    const parsed = request.parsed;
    const occupied = !!parsed.inputValue && request.state === "pending";
    return { requestId: request.id, source: { sessionId: request.sessionId, agent: this.ports.agent },
      kind: occupied ? "unknown" : parsed.kind, question: parsed.question,
      detail: occupied ? [parsed.detail, parsed.inputValue].filter(Boolean).join("\n") : parsed.detail,
      options: occupied ? [] : parsed.options.map(option => ({ ...option })), selected: parsed.selected,
      selectedIndices: [...parsed.selectedIndices], input: occupied ? null : parsed.input && { ...parsed.input },
      state: request.state, optionsComplete: parsed.optionsComplete };
  }

  readChoice(): TerminalChoice | null {
    const request = this.observe();
    if (!request || request.parsed.control !== "arrows" || request.parsed.selected === null) return null;
    const { question, detail, selected, axis, options } = request.parsed;
    return { question, detail, selected, axis, options: options.map(option => ({ ...option })), signature: request.id };
  }

  /** Also called after protocol-only output settles, including while the room is hidden. */
  refresh() { if (this.current || this.completion || this.inFlight) this.observe(); }

  answerChoice(signature: string, index: number): "sent" | "changed" | "unavailable" {
    const request = this.observe();
    if (!this.ports.session()) return "unavailable";
    if (!request || request.id !== signature || request.state !== "pending" || this.inFlight
      || request.parsed.control !== "arrows" || !request.parsed.options.some(option => option.index === index)) return "changed";
    void this.answer(signature, { kind: "single", index });
    return "sent";
  }

  async answer(requestId: string, answer: TerminalInteractionAnswer): Promise<TerminalInteractionResult> {
    const request = this.observe();
    if (!this.ports.session() || this.disposed) return { status: "unavailable" };
    if (!request || request.id !== requestId) return { status: "changed" };
    if (this.inFlight || request.state !== "pending") return { status: "busy" };
    if (!this.ports.outputSettled()) return { status: "busy" };
    const initial = request.parsed;
    const report = terminalStatusFor(this.ports.agent, this.ports.programStatus?.());
    const nativeGuard = this.ports.agent === "codex" && report
      ? { requestId: request.id, protocolSequence: report.sequence } : undefined;
    const input = interactionInput(initial, answer, this.ports.terminal.modes.applicationCursorKeysMode);
    if (!input) return { status: "invalid" };
    request.state = "submitting";
    this.inFlight = request;
    const current = () => this.observe() === request && this.ports.session() === request.sessionId
      && this.ports.outputSettled();
    const atTarget = () => current() && request.parsed.selected === input.selected
      && sameIndices(request.parsed.selectedIndices, input.indices ?? initial.selectedIndices);
    try {
      const result = await this.ports.write({ keys: input.keys, text: input.text, navigation: input.navigation, nativeGuard,
        valid: () => current() && request.parsed.signature === initial.signature
          && request.parsed.selected === initial.selected
          && sameIndices(request.parsed.selectedIndices, initial.selectedIndices),
        navigationReady: () => this.waitForNavigation(request, atTarget),
        validAfterNavigation: atTarget,
        validAfterPaste: () => current() && request.parsed.contextSignature === initial.contextSignature,
      });
      request.state = result.status === "sent" ? "submitted" : result.status === "uncertain" ? "uncertain" : "pending";
      if (result.status === "sent" && nativeGuard) {
        this.completion = { sessionId: request.sessionId, identity: request.identity, guard: nativeGuard };
      }
      return result;
    } catch {
      request.state = "uncertain";
      return { status: "uncertain" };
    } finally { this.inFlight = null; this.observe(); }
  }

  dispose() {
    this.disposed = true;
    this.current = null;
    this.completion = null;
    this.output.dispose();
  }

  private async waitForNavigation(request: Request, ready: () => boolean): Promise<boolean> {
    // Only while a user answer is in flight. No persistent timer on idle terminals.
    const deadline = Date.now() + 1500;
    do {
      if (this.observe() !== request || this.disposed) return false;
      if (ready()) return true;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (Date.now() < deadline);
    return false;
  }

  private observe(): Request | null {
    const sessionId = this.disposed ? null : this.ports.session();
    if (!sessionId) { this.current = null; this.completion = null; return null; }
    const report = terminalStatusFor(this.ports.agent, this.ports.programStatus?.());
    const identity = JSON.stringify([this.ports.scope?.() ?? null, this.ports.terminal.buffer.active.type]);
    let parsed = readInteractionScreen(this.ports.terminal, this.ports.agent);
    this.finishCompleted(sessionId, identity, report, parsed);
    const blocked = report?.programStatus.state === "blocked";
    const working = this.ports.agent === "codex" && report?.programStatus.state === "working";
    if (usesTerminalStatus(this.ports.agent) && !blocked && !working) {
      this.current = null; return null;
    }
    const scope = JSON.stringify([identity, report?.sequence ?? null]);
    // Async questions are independent of foreground status; ordinary menus still need blocked.
    if (working && !parsed?.allowsWhileWorking) { this.current = null; return null; }
    const waiting = this.ports.waitingReason();
    if (!parsed && waiting !== null) parsed = unknownInteraction("", waiting);
    if (!parsed) { this.current = null; return null; }
    const current = this.current;
    const sameScope = current?.scope === scope || (current?.identity === identity && current.parsed.allowsWhileWorking && parsed.allowsWhileWorking);
    const same = current?.sessionId === sessionId && sameScope && (current.parsed.signature === parsed.signature
      || (!!parsed.inputValue && (current.state === "submitting" || current.state === "submitted") && current.parsed.control === "text"
        && current.parsed.contextSignature === parsed.contextSignature));
    if (same) { current.parsed = parsed; return current; }
    this.current = { id: `${this.instance}:${++this.generation}`, sessionId, scope, identity, parsed, state: "pending" };
    return this.current;
  }

  private finishCompleted(sessionId: string, identity: string,
    report: ReturnType<typeof terminalStatusFor>, parsed: ParsedInteraction | null) {
    const completion = this.completion;
    if (!completion) return;
    if (completion.sessionId !== sessionId || completion.identity !== identity) { this.completion = null; return; }
    if (this.inFlight || !report || parsed || !this.ports.outputSettled() || !this.ports.finishInteraction
      || (report.programStatus.state !== "idle" && report.programStatus.state !== "done")
      || report.sequence <= completion.guard.protocolSequence || completion.lastReadySequence === report.sequence) return;
    completion.lastReadySequence = report.sequence;
    void this.ports.finishInteraction(sessionId, completion.guard, report.sequence).then(released => {
      if (released && this.completion === completion) this.completion = null;
    }).catch(() => { /* Retain ownership when native completion cannot be confirmed. */ });
  }
}

function sameIndices(a: number[], b: number[]) { return a.length === b.length && a.every((value, at) => value === b[at]); }

interface InputPlan extends Pick<InteractionWrite, "keys" | "text" | "navigation"> { selected?: number; indices?: number[] }

function interactionInput(parsed: ParsedInteraction, answer: TerminalInteractionAnswer, applicationCursor: boolean): InputPlan | null {
  if (!answer || typeof answer !== "object") return null;
  if (answer.kind === "single") {
    if (parsed.control === "yes-no") {
      const at = parsed.options.findIndex(option => option.index === answer.index);
      const key = parsed.answers?.[at];
      return key ? { keys: `${key}\r` } : null;
    }
    if (parsed.control !== "arrows" || parsed.selected === null) return null;
    const keys = choiceKeys({ ...parsed, selected: parsed.selected }, answer.index, applicationCursor);
    return keys ? { navigation: keys.slice(0, -1), keys: "\r", selected: answer.index } : null;
  }
  if (answer.kind === "input") {
    if (parsed.control !== "text" || parsed.inputValue || typeof answer.text !== "string" || (!answer.text.trim() && !parsed.input?.optional) || answer.text.length > 16_384
      || /[\u0000-\u0008\u000b-\u001f\u007f]/u.test(answer.text)) return null;
    if (!answer.text.trim()) return { keys: "\r" };
    return { keys: parsed.inputPrefix, text: answer.text };
  }
  if (answer.kind !== "multiple" || !Array.isArray(answer.indices) || parsed.control !== "checkboxes" || !parsed.optionsComplete || parsed.selected === null
    || new Set(answer.indices).size !== answer.indices.length
    || answer.indices.some(index => !parsed.options.some(option => option.index === index))) return null;
  let selected = parsed.selected, keys = "";
  const prefix = applicationCursor ? "\u001bO" : "\u001b[";
  for (const option of parsed.options) {
    if (parsed.selectedIndices.includes(option.index) === answer.indices.includes(option.index)) continue;
    const delta = option.index - selected;
    keys += `${prefix}${delta > 0 ? "B" : "A"}`.repeat(Math.abs(delta)) + " ";
    selected = option.index;
  }
  return { navigation: keys, keys: "\r", selected, indices: parsed.options.filter(option => answer.indices.includes(option.index)).map(option => option.index) };
}
