import { describe, expect, it } from "vitest";
import { protocolActivity, protocolIdle, sessionActivity, terminalStatusFor } from "./programStatus";
import { statusReport } from "../terminal/fixtures/programStatus";

describe.each(["codex", "claude"] as const)("%s native status", agent => {
  it("uses the reported state even when legacy activity, lifecycle and wording disagree", () => {
    const blocked = { ...statusReport(agent, "blocked", 1, "question"), state: "completed" as const,
      reason: "idle, done, completed", programStatus: { ...statusReport(agent, "blocked").programStatus!,
        message: "done; ready for your next instruction" } };
    expect(protocolIdle(agent, blocked)).toBe(false);
    expect(sessionActivity({ kind: agent, activity: "idle", agentState: blocked })).toBe("awaiting-choice");
    const idle = { ...statusReport(agent, "idle"), state: "processing" as const, reason: "busy" };
    expect(protocolIdle(agent, idle)).toBe(true);
    expect(protocolActivity(idle)).toBe("idle");
    expect(protocolIdle(agent, statusReport(agent, "done"))).toBe(true);
    for (const state of ["working", "blocked", "error", "clear"] as const) {
      expect(protocolIdle(agent, statusReport(agent, state))).toBe(false);
    }
  });

  it("waits when the report is missing, belongs to another agent, or comes from a Hook or process", () => {
    const report = statusReport(agent, "idle");
    const other = agent === "codex" ? "claude" : "codex";
    for (const snapshot of [null, { ...report, programStatus: null }, statusReport(other, "idle"),
      { ...report, source: "hook" as const }, { ...report, source: "screen_heuristic" as const },
      { ...report, source: "process" as const }]) {
      expect(terminalStatusFor(agent, snapshot)).toBeNull();
      expect(protocolIdle(agent, snapshot)).toBe(false);
      expect(sessionActivity({ kind: agent, activity: "idle", agentState: snapshot })).toBe("talking");
    }
  });
});
