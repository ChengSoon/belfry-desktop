import { describe, expect, it } from "vitest";
import { canDispatchPrompt, isAgentKind, isPromptBusy } from "./contracts";
import { statusReport } from "../terminal/fixtures/programStatus";

describe("prompt contracts", () => {
  it("dispatches only to running Agent tabs that are not producing output", () => {
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "idle" })).toBe(false);
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "idle", agentState: statusReport("codex", "idle") })).toBe(true);
    expect(canDispatchPrompt({ kind: "claude", phase: "running", activity: "awaiting-choice" }))
      .toBe(false);
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "talking" })).toBe(false);
    expect(canDispatchPrompt({ kind: "shell", phase: "running", activity: "idle" })).toBe(false);
    expect(canDispatchPrompt({ kind: "claude", phase: "exited", activity: "idle" })).toBe(false);
  });

  it("treats output and permission choices as busy", () => {
    expect(isPromptBusy({ activity: "talking" })).toBe(true);
    expect(isPromptBusy({ activity: "awaiting-choice" })).toBe(true);
    expect(isAgentKind("codex")).toBe(true);
    expect(isAgentKind("ssh")).toBe(false);
  });

  it.each(["codex", "claude"] as const)("%s requires its own report, even when a screen or Hook claims idle", agent => {
    const report = statusReport(agent, "idle");
    const tab = { kind: agent, phase: "running" as const, activity: "idle" as const };
    expect(canDispatchPrompt(tab)).toBe(false);
    expect(canDispatchPrompt({ ...tab, agentState: { ...report, source: "hook" } })).toBe(false);
    expect(canDispatchPrompt({ ...tab, agentState: { ...report, source: "screen_heuristic" } })).toBe(false);
    expect(canDispatchPrompt({ ...tab, agentState: { ...report, programStatus: null } })).toBe(false);
    for (const state of ["working", "blocked", "clear", "error"] as const) {
      expect(canDispatchPrompt({ ...tab, agentState: statusReport(agent, state) })).toBe(false);
      expect(isPromptBusy({ ...tab, agentState: statusReport(agent, state) })).toBe(state === "working" || state === "blocked");
    }
    expect(isPromptBusy(tab)).toBe(false);
    expect(canDispatchPrompt({ ...tab, agentState: report })).toBe(true);
  });
});
