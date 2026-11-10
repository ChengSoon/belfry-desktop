import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { TerminalInteractions } from "../../../terminal/controller/interaction";
import { PromptInput } from "../../../terminal/promptInput";
import { configureUnicode } from "../../../terminal/unicode";
import { watchActivity } from "../../../terminal/activity";
import type { TerminalInteractionAnswer } from "../../../terminal/interaction";
import corpus from "../../../terminal/fixtures/codex-0.167.0.json";

const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
configureUnicode(terminal);
terminal.open(document.getElementById("terminal")!);
let session: string | null = "fixture-pty";
let afterPaste = "echo";
let activity = "idle";
let failure = false;
let source = "";
let remote = false;
const writes: Array<{ sessionId: string; data: string }> = [];
const errors: string[] = [];
const raw = (text: string) => new Promise<void>(resolve => terminal.write(text, resolve));
const paint = (text: string) => raw(`\u001b[?2004h\u001b[2J\u001b[H${text.replace(/\n/g, "\r\n")}`);
const prompt = new PromptInput({ session: () => session, paste: text => terminal.paste(text),
  enter: () => terminal.input("\r", true), error: error => errors.push(String(error)), settleMs: 25,
  write: async (sessionId, data) => {
    writes.push({ sessionId, data });
    if (failure) throw new Error("controlled write failure");
    const response = await fetch("/qa-choice-write", { method: "POST", body: JSON.stringify({ sessionId, data }) });
    if (!response.ok) throw new Error("Fixture transport failed");
    if (remote) { const frame = await response.json(); await paint(frame.screen); return; }
    if (data.startsWith("\u001b[200~")) {
      if (afterPaste === "changed") await paint(source.replace("Share details.", "A different request."));
      if (afterPaste === "disconnected") session = null;
      if (afterPaste === "user") prompt.onUserInput();
      if (afterPaste === "echo") await paint(source.replace(/Type your answer(?: \(optional\))?|Add notes/, data.slice(6, -6).replace(/\r/g, "\n  ")));
    }
  } });
terminal.onData(data => prompt.onData(data));
const interactions = new TerminalInteractions({ terminal, agent: "codex", session: () => session,
  waitingReason: () => null, outputSettled: () => true, write: request => prompt.sendInteraction(request) });
watchActivity(terminal, next => { activity = next; }, "codex");

Object.assign(window, { qaChoice: {
  async connectProcess() {
    remote = true;
    const frame = await (await fetch("/qa-choice-state")).json();
    await paint(frame.screen);
    return interactions.read();
  },
  remoteState: async () => (await fetch("/qa-choice-state")).json(),
  async show(name: keyof typeof corpus.fixtures, outcome = "echo") {
    afterPaste = outcome; failure = false; source = corpus.fixtures[name].screen;
    await paint(source);
    return interactions.read();
  },
  read: () => interactions.read(),
  open: (id: string, optionIndex?: number) => interactions.open(id, optionIndex),
  answer: (id: string, answer: TerminalInteractionAnswer) => interactions.answer(id, answer),
  snapshot: () => ({ writes: [...writes], errors: [...errors], activity, request: interactions.read() }),
  fail: () => { failure = true; },
  dispose: () => { interactions.dispose(); prompt.dispose(); terminal.dispose(); },
} });
