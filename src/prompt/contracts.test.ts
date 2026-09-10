import { describe, expect, it } from "vitest";
import { canDispatchPrompt, isAgentKind, isPromptBusy } from "./contracts";

describe("prompt contracts", () => {
  it("dispatches only to running Agent tabs that are not producing output", () => {
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "idle" })).toBe(true);
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
});
