import { usesTerminalStatus, type AgentKind, type TerminalProgramStatus } from "./contracts";
import type { HookSnapshot } from "./hooks/contracts";
import type { SessionActivity } from "../terminal/contracts";

type TerminalStatusSnapshot = HookSnapshot & { programStatus: TerminalProgramStatus };

export function terminalStatusFor(agent: unknown, snapshot: HookSnapshot | null | undefined): TerminalStatusSnapshot | null {
  return usesTerminalStatus(agent) && snapshot?.agent === agent && snapshot.source === "terminal_protocol"
    && snapshot.programStatus ? snapshot as TerminalStatusSnapshot : null;
}

/** Unknown status closes input until a root protocol report arrives. */
export function protocolActivity(snapshot: HookSnapshot | null | undefined): SessionActivity {
  const state = terminalStatusFor(snapshot?.agent, snapshot)?.programStatus.state;
  return state === "idle" || state === "done" ? "idle" : state === "blocked" ? "awaiting-choice" : "talking";
}

export function sessionActivity(tab: { kind?: string; activity: SessionActivity; agentState?: HookSnapshot | null }) {
  return usesTerminalStatus(tab.kind) ? protocolActivity(terminalStatusFor(tab.kind, tab.agentState)) : tab.activity;
}

export function protocolIdle(agent: AgentKind | null, snapshot: HookSnapshot | null | undefined) {
  const state = terminalStatusFor(agent, snapshot)?.programStatus.state;
  return state === "idle" || state === "done";
}
