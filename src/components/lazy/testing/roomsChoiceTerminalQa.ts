import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalCommandTarget } from "../../../terminal/contracts";
import { TerminalInteractions } from "../../../terminal/controller/interaction";
import { PromptInput } from "../../../terminal/promptInput";
import { configureUnicode } from "../../../terminal/unicode";
import { statusReport } from "../../../terminal/fixtures/programStatus";
import type { HookSnapshot } from "../../../agent/hooks/contracts";
import type { TerminalProgramStatus } from "../../../agent/contracts";

/** Real xterm and input handling connected only to the isolated QA consumer. */
export async function createRoomTerminalQa() {
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.inert = true;
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:1200px;height:900px";
  document.body.append(host);
  const terminal = new Terminal({ cols: 120, rows: 40, allowProposedApi: true });
  configureUnicode(terminal);
  terminal.open(host);
  const sessionId = "room-qa-pty";
  const errors: string[] = [];
  let currentReport = statusReport("codex", "clear", 0);
  const listeners = new Set<(report: HookSnapshot, tabId: string) => void>();
  const paint = (screen: string) => new Promise<void>(resolve => {
    terminal.write(`\u001b[?2004h\u001b[2J\u001b[H${screen.replace(/\n/g, "\r\n")}`, resolve);
  });
  const acceptFrame = async (frame: { screen: string; sequence: number; programStatus: TerminalProgramStatus }) => {
    await paint(frame.screen);
    currentReport = { ...statusReport("codex", frame.programStatus.state, frame.sequence, frame.programStatus.kind),
      programStatus: frame.programStatus };
    for (const listener of listeners) listener(currentReport, "t2");
  };
  const prompt = new PromptInput({ session: () => sessionId, paste: text => terminal.paste(text),
    enter: () => terminal.input("\r", true), error: error => errors.push(String(error)), settleMs: 25,
    write: async (sessionId, data) => {
      const response = await fetch("/qa-choice-write", { method: "POST", body: JSON.stringify({ sessionId, data }) });
      if (!response.ok) throw new Error("Controlled room terminal transport failed");
      const frame = await response.json();
      await acceptFrame(frame);
    } });
  terminal.onData(data => prompt.onData(data));
  const interactions = new TerminalInteractions({ terminal, agent: "codex", session: () => sessionId,
    waitingReason: () => null, outputSettled: () => true, write: request => prompt.sendInteraction(request) });
  const initial = await (await fetch("/qa-choice-state")).json();
  await acceptFrame(initial);
  const target: TerminalCommandTarget = {
    focus: () => {}, sendText: () => false, getSessionId: () => sessionId,
    readInteraction: () => interactions.read(), answerInteraction: (requestId, answer) => interactions.answer(requestId, answer),
  };
  Object.assign(window, { qaRoomTerminal: { read: () => interactions.read(), paint, errors } });
  window.addEventListener("pagehide", () => { interactions.dispose(); prompt.dispose(); terminal.dispose(); host.remove(); }, { once: true });
  return { targets: new Map([["t2", target]]), snapshot: () => currentReport,
    subscribeReport(listener: (report: HookSnapshot, tabId: string) => void) {
      listeners.add(listener); listener(currentReport, "t2");
      return () => { listeners.delete(listener); };
    },
  };
}
