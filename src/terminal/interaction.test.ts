import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { TerminalInteractions } from "./controller/interaction";
import { PromptInput } from "./promptInput";
import { configureUnicode } from "./unicode";
import { readInteractionScreen } from "./interactionScreen";
import type { AgentKind } from "../agent/contracts";
import type { TerminalInteractionAnswer } from "./interaction";
import corpus from "./fixtures/codex-0.167.0.json";
import captured from "./fixtures/codex-current-menus.json";
import { statusReport } from "./fixtures/programStatus";
import { usesTerminalStatus, type TerminalProgramStatus } from "../agent/contracts";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(dispose => dispose()); });
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const question = corpus.fixtures["codex-input-options"].screen;
const freeform = corpus.fixtures["codex-input-freeform"].screen;
const checks = "Status line\n\nType to search\n\n› [x] Model  Current model\n  [ ] Tokens  Tokens used\n  [x] Branch  Git branch\n\nspace toggle · ←/→ reorder · enter save · esc cancel";

function fixture(agent: AgentKind | null = "codex", dimensions = { cols: 120, rows: 60 }) {
  const terminal = new Terminal({ ...dimensions, allowProposedApi: true, scrollback: 100 });
  configureUnicode(terminal);
  let session: string | null = "pty-a", scope: string | null = "native-a", settled = true, waiting: string | null = null;
  let report = usesTerminalStatus(agent) ? statusReport(agent, "blocked") : null;
  const writes: Array<{ sessionId: string; data: string }> = [];
  const errors: unknown[] = [];
  let onWrite: ((data: string) => Promise<void>) | null = null;
  let source = "";
  const raw = (text: string) => new Promise<void>(resolve => terminal.write(text, resolve));
  const paint = (text: string) => { source = text; return raw(`\u001b[?2004h\u001b[2J\u001b[H${text.replace(/\n/g, "\r\n")}`); };
  const navigate = async (data: string) => {
    if (!/^(?:\u001b(?:\[|O)[AB]| )+$/u.test(data)) return;
    const lines = source.split("\n");
    const rows = lines.map((line, at) => ({ line, at })).filter(row => /^\s*(?:[›❯▶]\s*)?(?:\d+[.)]|\[[ xX]\])\s/.test(row.line));
    let selected = rows.findIndex(row => /^\s*[›❯▶]/.test(row.line));
    for (const key of data.match(/\u001b(?:\[|O)[AB]| /gu) ?? []) {
      if (key === " ") rows[selected].line = rows[selected].line.replace(/\[([ xX])\]/, (_, mark) => mark.trim() ? "[ ]" : "[x]");
      else selected = Math.max(0, Math.min(rows.length - 1, selected + (key.endsWith("B") ? 1 : -1)));
    }
    rows.forEach((row, at) => {
      let line = row.line.replace(/^([\s]*)[›❯▶]/, "$1 ");
      if (at === selected) line = line.replace(/^\s*/, spaces => `${spaces.slice(0, -2)}› `);
      lines[row.at] = line;
    });
    await paint(lines.join("\n"));
  };
  // Headless xterm has no textarea. Browser regression below exercises native paste;
  // these queue tests provide its onData event while retaining the real parser/modes.
  const prompt = new PromptInput({ session: () => session, paste: text => terminal.input(
    `${terminal.modes.bracketedPasteMode ? "\u001b[200~" : ""}${text.replace(/\r?\n/g, "\r")}${terminal.modes.bracketedPasteMode ? "\u001b[201~" : ""}`, true),
    enter: () => terminal.input("\r", true), settleMs: 5, error: error => errors.push(error),
    write: async (sessionId, data) => { writes.push({ sessionId, data }); await (onWrite ? onWrite(data) : navigate(data)); } });
  const data = terminal.onData(text => prompt.onData(text));
  const interactions = new TerminalInteractions({ terminal, agent, session: () => session,
    scope: () => scope,
    programStatus: () => report,
    outputSettled: () => settled, waitingReason: () => waiting, write: request => prompt.sendInteraction(request) });
  cleanup.push(() => { interactions.dispose(); data.dispose(); prompt.dispose(); terminal.dispose(); });
  return { terminal, interactions, prompt, writes, errors, raw, paint,
    status: (state: TerminalProgramStatus["state"] | null) => {
      report = state && usesTerminalStatus(agent) ? statusReport(agent, state, (report?.sequence ?? 0) + 1) : null;
    },
    session: (value: string | null) => { session = value; },
    scope: (value: string | null) => { scope = value; },
    settled: (value: boolean) => { settled = value; },
    waiting: (value: string | null) => { waiting = value; },
    write: (callback: NonNullable<typeof onWrite>) => { onWrite = callback; },
    answer: (answer: TerminalInteractionAnswer) => interactions.answer(interactions.read()!.requestId, answer) };
}

describe("real xterm screens through request tracking and serialized input", () => {
  it("reads the current CLI permission menu and submits to its exact PTY", async () => {
    const f = fixture();
    await f.paint(captured.fixtures.permissions.screen);
    const request = f.interactions.read()!;
    expect(request.question).toBe("Update Model Permissions");
    expect(request.options).toHaveLength(4);
    expect(request.options[0].description).toContain("access or edits outside the workspace");
    expect(request.source).toEqual({ sessionId: "pty-a", agent: "codex" });
    expect(await f.answer({ kind: "single", index: 4 })).toEqual({ status: "sent" });
    expect(f.writes).toEqual([{ sessionId: "pty-a", data: "\u001b[B\u001b[B\u001b[B" }, { sessionId: "pty-a", data: "\r" }]);
    expect(f.interactions.read()?.state).toBe("submitted");
  });

  it("shows a partial model page while keeping hidden checkbox state terminal-only", async () => {
    const f = fixture();
    await f.paint(captured.fixtures.model.screen);
    expect(f.interactions.read()?.optionsComplete).toBe(false);
    expect(f.interactions.read()?.selected).toBe(2);
    expect(await f.answer({ kind: "single", index: 4 })).toEqual({ status: "sent" });
    expect(f.writes.map(write => write.data)).toEqual(["\u001b[B\u001b[B", "\r"]);
    await f.paint(captured.fixtures.statusline.screen);
    expect(f.interactions.read()?.kind).toBe("unknown");
    expect(f.interactions.read()?.question).toContain("Configure Status Line");
    expect(await f.answer({ kind: "multiple", indices: [1] })).toEqual({ status: "invalid" });
    expect(f.writes).toHaveLength(2);
  });

  it("re-reads the current cursor and uses application cursor mode", async () => {
    const f = fixture();
    await f.paint(question);
    const first = f.interactions.read()!;
    await f.paint(question.replace("› 1.", "  1.").replace("    2. Option", "  › 2. Option"));
    await f.raw("\u001b[?1h");
    const moved = f.interactions.read()!;
    expect(moved.requestId).toBe(first.requestId);
    expect(moved.selected).toBe(2);
    expect(await f.interactions.answer(first.requestId, { kind: "single", index: 1 })).toEqual({ status: "sent" });
    expect(f.writes.map(write => write.data)).toEqual(["\u001bOA", "\r"]);
  });

  it("applies the desired checkbox set from actual checked state, then confirms once", async () => {
    const f = fixture();
    await f.paint(checks);
    expect(f.interactions.read()?.selectedIndices).toEqual([1, 3]);
    expect(await f.answer({ kind: "multiple", indices: [2] })).toEqual({ status: "sent" });
    expect(f.writes.map(write => write.data)).toEqual([" \u001b[B \u001b[B ", "\r"]);
  });

  it("types into a verified input with bracketed paste, waits, and submits once", async () => {
    const f = fixture();
    await f.paint(freeform);
    const id = f.interactions.read()!.requestId;
    f.write(async data => {
      if (data.startsWith("\u001b[200~")) await f.paint(freeform.replace("Type your answer (optional)", "First line\n    第二行"));
    });
    expect(await f.answer({ kind: "input", text: "First line\n第二行" })).toEqual({ status: "sent" });
    expect(f.writes.map(write => write.data)).toEqual(["\u001b[200~First line\r第二行\u001b[201~", "\r"]);
    expect(f.interactions.read()?.requestId).toBe(id);
    expect(f.interactions.read()?.state).toBe("submitted");
  });

  it("does not overwrite a draft already entered in the terminal", async () => {
    const f = fixture();
    await f.paint(freeform.replace("Type your answer (optional)", "My unfinished answer"));
    expect(f.interactions.read()?.kind).toBe("unknown");
    expect(f.interactions.read()?.detail).toContain("My unfinished answer");
    expect(await f.answer({ kind: "input", text: "replacement" })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });

  it("does not treat a literal Other answer as an empty freeform placeholder", async () => {
    const f = fixture();
    await f.paint(freeform.replace("Type your answer (optional)", "Other"));
    expect(f.interactions.read()?.kind).toBe("unknown");
    expect(await f.answer({ kind: "input", text: "replacement" })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });

  it.each(["async", "other", "notes"])("submits %s input without losing the enclosing request when its draft renders", async kind => {
    const f = fixture();
    const source = kind === "async" ? corpus.fixtures["codex-async-input"].screen
      : kind === "notes" ? corpus.fixtures["codex-input-notes"].screen
        : "Which path?\n\n  1. Existing directory\n› 2. Other\n\nenter submit   ⌃] skip   ⇧→ main prompt";
    const placeholder = kind === "async" ? "Type your answer" : kind === "notes" ? "Add notes" : "Other";
    await f.paint(source);
    const id = f.interactions.read()!.requestId;
    expect(f.interactions.read()?.kind).toBe("input");
    f.write(async data => { if (data.startsWith("\u001b[200~")) await f.paint(source.replace(placeholder, "My answer")); });
    expect(await f.answer({ kind: "input", text: "My answer" })).toEqual({ status: "sent" });
    expect(f.interactions.read()?.requestId).toBe(id);
    expect(f.writes.map(write => write.data)).toEqual(["\u001b[200~My answer\u001b[201~", "\r"]);
  });

  it("allows an explicit empty answer only when the original input says optional", async () => {
    const f = fixture();
    await f.paint(freeform);
    expect(f.interactions.read()?.input?.optional).toBe(true);
    expect(await f.answer({ kind: "input", text: "" })).toEqual({ status: "sent" });
    expect(f.writes.map(write => write.data)).toEqual(["\r"]);
    await f.paint(freeform.replace(" (optional)", ""));
    expect(await f.answer({ kind: "input", text: "" })).toEqual({ status: "invalid" });
    expect(f.writes).toHaveLength(1);
  });

  it("requires the y/n prompt to be on the actual cursor line and never assumes a default", async () => {
    const f = fixture(null);
    await f.paint("Continue? [Y/n]");
    expect(f.interactions.read()?.selected).toBeNull();
    expect(await f.answer({ kind: "single", index: 2 })).toEqual({ status: "sent" });
    expect(f.writes[0].data).toBe("n\r");
    await f.paint("Continue? [Y/n]\n");
    expect(f.interactions.read()).toBeNull();
  });

  it("uses the full live screen and preserves spaces at soft-wrap boundaries", async () => {
    const f = fixture("codex", { cols: 40, rows: 60 });
    const detail = Array.from({ length: 33 }, (_, i) => `$ command ${i}`).join("\n");
    await f.paint(`Would you like to run the following command?\n\n${detail}\n\n› 1. Keep current files\n  2. Use selected files\n\nPress enter to confirm or esc to cancel`);
    const request = f.interactions.read()!;
    expect(request.question).toBe("Would you like to run the following command?");
    expect(request.detail).toBe(detail);
    expect(request.options[0].label).toBe("Keep current files");
    f.terminal.scrollToTop();
    expect(f.interactions.read()?.requestId).toBe(request.requestId);
  });

  it("keeps explicit unknown waiting visible without enabling guessed input", async () => {
    const f = fixture("claude");
    await f.paint("An unrecognized permission dialog");
    f.waiting("Permission requested by the current tool");
    expect(f.interactions.read()?.kind).toBe("unknown");
    expect(await f.answer({ kind: "single", index: 1 })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });

  it("does not turn a clipped approval command into a question with live buttons", async () => {
    const f = fixture("codex", { cols: 80, rows: 12 });
    await f.paint(`Would you like to run the following command?\n\n${"$ context line\n".repeat(20)}\n› 1. Yes, proceed\n  2. No, cancel\nPress enter to confirm or esc to cancel`);
    expect(f.interactions.read()?.kind).toBe("unknown");
    expect(await f.answer({ kind: "single", index: 1 })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });
});

describe("request lifetime and write outcomes", () => {
  it("blocks duplicate clicks during a write and after it was submitted", async () => {
    const f = fixture(), write = deferred();
    await f.paint(question);
    f.write(() => write.promise);
    const id = f.interactions.read()!.requestId;
    const first = f.interactions.answer(id, { kind: "single", index: 1 });
    await tick();
    expect(f.interactions.read()?.state).toBe("submitting");
    expect(await f.interactions.answer(id, { kind: "single", index: 2 })).toEqual({ status: "busy" });
    expect(f.writes).toHaveLength(1);
    write.resolve();
    expect(await first).toEqual({ status: "sent" });
    expect(await f.interactions.answer(id, { kind: "single", index: 2 })).toEqual({ status: "busy" });
    expect(f.writes).toHaveLength(1);
  });

  it("invalidates a disappeared request even if the identical menu returns between polls", async () => {
    const f = fixture();
    await f.paint(question);
    const id = f.interactions.read()!.requestId;
    f.status("working");
    await f.paint("Working (Esc to interrupt)");
    await tick(); // no UI read while the dialog is absent
    f.status("blocked");
    await f.paint(question);
    expect(f.interactions.read()?.requestId).not.toBe(id);
    expect(await f.interactions.answer(id, { kind: "single", index: 1 })).toEqual({ status: "changed" });
    expect(f.writes).toEqual([]);
  });

  it("cannot send to a replaced, disconnected, or disposed session", async () => {
    const f = fixture();
    await f.paint(question);
    const id = f.interactions.read()!.requestId;
    f.session("pty-b");
    expect(f.interactions.read()?.source.sessionId).toBe("pty-b");
    expect(await f.interactions.answer(id, { kind: "single", index: 1 })).toEqual({ status: "changed" });
    f.session(null);
    expect(await f.interactions.answer(id, { kind: "single", index: 1 })).toEqual({ status: "unavailable" });
    f.interactions.dispose();
    expect(f.interactions.read()).toBeNull();
    expect(f.writes).toEqual([]);
  });

  it("cannot overtake output still waiting to be parsed", async () => {
    const f = fixture();
    await f.paint(question);
    f.settled(false);
    expect(await f.answer({ kind: "single", index: 1 })).toEqual({ status: "busy" });
    expect(f.writes).toEqual([]);
  });

  it("invalidates an identical prompt when the native conversation changes inside a PTY", async () => {
    const f = fixture();
    await f.paint(question);
    const id = f.interactions.read()!.requestId;
    f.scope("native-b");
    expect(f.interactions.read()?.requestId).not.toBe(id);
    expect(await f.interactions.answer(id, { kind: "single", index: 1 })).toEqual({ status: "changed" });
    expect(f.writes).toEqual([]);
  });

  it("revalidates the screen inside the input queue, after preceding keyboard writes", async () => {
    const f = fixture(), prior = deferred();
    await f.paint(question);
    f.write(() => prior.promise);
    f.terminal.input("prior-key", true);
    await tick();
    const answer = f.answer({ kind: "single", index: 2 });
    await f.paint(question.replace("Choose an option.", "Another request."));
    prior.resolve();
    expect(await answer).toEqual({ status: "changed" });
    expect(f.writes.map(write => write.data)).toEqual(["prior-key"]);
  });

  it("rejects a cursor change that happened while waiting for the input queue", async () => {
    const f = fixture(), prior = deferred();
    await f.paint(question);
    f.write(() => prior.promise);
    f.terminal.input("prior-key", true);
    await tick();
    const answer = f.answer({ kind: "single", index: 2 });
    await f.paint(question.replace("› 1.", "  1.").replace("    2. Option", "  › 2. Option"));
    prior.resolve();
    expect(await answer).toEqual({ status: "changed" });
    expect(f.writes).toHaveLength(1);
  });

  it("returns uncertainty on a transport rejection and never automatically retries", async () => {
    const f = fixture();
    await f.paint(question);
    f.write(async () => { throw new Error("write interrupted after partial transfer"); });
    const id = f.interactions.read()!.requestId;
    expect(await f.answer({ kind: "single", index: 1 })).toEqual({ status: "uncertain" });
    expect(f.interactions.read()?.state).toBe("uncertain");
    expect(f.errors).toHaveLength(1);
    expect(await f.interactions.answer(id, { kind: "single", index: 1 })).toEqual({ status: "busy" });
    expect(f.writes).toHaveLength(1);
  });

  it("does not confirm if navigation keys are ignored or remapped", async () => {
    const f = fixture();
    await f.paint(question);
    f.write(async () => {}); // The consumer ignored Down; the cursor did not move.
    expect(await f.answer({ kind: "single", index: 2 })).toEqual({ status: "uncertain" });
    expect(f.writes.map(write => write.data)).toEqual(["\u001b[B"]);
    expect(f.interactions.read()?.state).toBe("uncertain");
  });

  it.each(["changed", "user-input", "disconnected"])("does not append Enter when %s occurs after a paste", async situation => {
    const f = fixture();
    await f.paint(freeform);
    f.write(async () => {
      if (situation === "changed") await f.paint(freeform.replace("Share details.", "Different question."));
      if (situation === "user-input") f.prompt.onUserInput();
      if (situation === "disconnected") f.session(null);
    });
    expect(await f.answer({ kind: "input", text: "my answer" })).toEqual({ status: "uncertain" });
    expect(f.writes.map(write => write.data)).toEqual(["\u001b[200~my answer\u001b[201~"]);
  });

  it("rejects absent options, malformed answers and terminal control characters", async () => {
    const f = fixture();
    await f.paint(question);
    expect(await f.answer({ kind: "single", index: 99 })).toEqual({ status: "invalid" });
    expect(await f.answer(null as unknown as TerminalInteractionAnswer)).toEqual({ status: "invalid" });
    await f.paint(freeform);
    expect(await f.answer({ kind: "input", text: "answer\u001b[A" })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });

  it("does not pretend multiline text is safe when bracketed paste is disabled", async () => {
    const f = fixture();
    await f.paint(freeform);
    await f.raw("\u001b[?2004l");
    expect(await f.answer({ kind: "input", text: "one\ntwo" })).toEqual({ status: "invalid" });
    expect(f.writes).toEqual([]);
  });

  it("preserves the old choice API with request-bound replay protection", async () => {
    const f = fixture();
    await f.paint(question);
    const choice = f.interactions.readChoice()!;
    expect(f.interactions.answerChoice(choice.signature, 2)).toBe("sent");
    expect(f.interactions.answerChoice(choice.signature, 2)).toBe("changed");
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(f.writes).toHaveLength(2);
    await f.paint("› ");
    expect(f.interactions.answerChoice(choice.signature, 2)).toBe("changed");
  });
});

it("reads a real OpenCode button selection from its inverse cell colors", async () => {
  const f = fixture("opencode");
  const accent = "\u001b[38;2;250;178;131m", reset = "\u001b[0m";
  const paint = (selected: number) => f.raw(`\u001b[2J\u001b[H${accent}  ┃${reset}  △ Permission required\r\n${accent}  ┃${reset}  Tool: echo\r\n${accent}  ┃${reset}   ${["Allow once", "Always allow", "Reject"].map((label, at) => at + 1 === selected ? `${accent}\u001b[7m${label}${reset}` : label).join("   ")}   ⇆ select  enter confirm`);
  await paint(2);
  f.write(async data => { if (data === "\u001b[C") await paint(3); });
  expect(readInteractionScreen(f.terminal, "opencode")?.selected).toBe(2);
  expect(await f.answer({ kind: "single", index: 3 })).toEqual({ status: "sent" });
  expect(f.writes.map(write => write.data)).toEqual(["\u001b[C", "\r"]);
});
