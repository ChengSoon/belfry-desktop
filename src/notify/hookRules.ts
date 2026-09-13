import type { NotifiableSession } from "./scheduler";
import { classifyTransition, type NotifyReason } from "./rules";

export function statusChanged(before: NotifiableSession, next: NotifiableSession): boolean {
  return before.activity !== next.activity || before.phase !== next.phase
    || before.agentState?.state !== next.agentState?.state
    || before.agentState?.source !== next.agentState?.source
    || before.agentState?.session?.id !== next.agentState?.session?.id;
}

export function notificationTransition(before: NotifiableSession, next: NotifiableSession): NotifyReason | null {
  if (next.kind === "shell" || next.kind === "ssh") return null;
  const state = next.agentState;
  if (state && state.source !== "screen_heuristic") {
    if (state.state === before.agentState?.state && state.session?.id === before.agentState?.session?.id) return null;
    if (state.state === "failed") return "failed";
    if (state.state === "completed" && state.source === "hook") return "finished";
    if (state.state === "awaiting_input" && before.activity !== "awaiting-choice") return "awaiting-choice";
    return null;
  }
  if (next.phase && next.phase !== "running") return null;
  if (before.agentState && before.agentState.source !== "screen_heuristic") return null;
  return classifyTransition(before.activity, next.activity, next.kind);
}
