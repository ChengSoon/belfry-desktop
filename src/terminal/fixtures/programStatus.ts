import type { HookSnapshot } from "../../agent/hooks/contracts";
import type { TerminalProgramStatus } from "../../agent/contracts";

export function statusReport(agent: "codex" | "claude", state: TerminalProgramStatus["state"], sequence = 1,
  kind: TerminalProgramStatus["kind"] = null): HookSnapshot {
  return { agent, source: "terminal_protocol", sequence, session: null, occurredAt: sequence,
    state: state === "idle" || state === "done" ? "completed" : state === "working" ? "processing"
      : state === "blocked" ? "awaiting_input" : state === "error" ? "failed" : "unknown",
    reason: "", transcriptPath: null, programStatus: { state, kind, progress: null, title: null, message: null } };
}
