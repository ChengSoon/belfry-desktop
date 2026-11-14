import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalProgramStatus } from "../../agent/contracts";
import { usesTerminalStatus } from "../../agent/contracts";
import type { SessionActivity } from "../contracts";

export function statusReport(agent: "codex" | "claude", state: TerminalProgramStatus["state"], sequence = 1,
  kind: TerminalProgramStatus["kind"] = null): HookSnapshot {
  return { agent, source: "terminal_protocol", sequence, session: null, occurredAt: sequence,
    state: state === "idle" || state === "done" ? "completed" : state === "working" ? "processing"
      : state === "blocked" ? "awaiting_input" : state === "error" ? "failed" : "unknown",
    reason: "", transcriptPath: null, programStatus: { state, kind, progress: null, title: null, message: null } };
}

/** Synthetic backend reports for browser fixtures that expose activity controls. */
export function activityReport(agent: unknown, activity: SessionActivity, sequence = 1): HookSnapshot | null {
  if (!usesTerminalStatus(agent)) return null;
  return statusReport(agent, activity === "idle" ? "idle" : activity === "awaiting-choice" ? "blocked" : "working",
    sequence, activity === "awaiting-choice" ? "permission" : null);
}
