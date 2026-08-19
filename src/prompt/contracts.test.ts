import { describe, expect, it } from "vitest";
import { canDispatchPrompt, isAgentKind, isPromptBusy, promptPreview } from "./contracts";

describe("prompt contracts", () => {
  it("dispatches only to running Agent tabs that are not producing output", () => {
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "idle" })).toBe(true);
    expect(canDispatchPrompt({ kind: "claude", phase: "running", activity: "awaiting-choice" }))
      .toBe(false);
    expect(canDispatchPrompt({ kind: "codex", phase: "running", activity: "talking" })).toBe(false);
    expect(canDispatchPrompt({ kind: "shell", phase: "running", activity: "idle" })).toBe(false);
    expect(canDispatchPrompt({ kind: "claude", phase: "exited", activity: "idle" })).toBe(false);
  });

  it("treats only active output as busy and builds compact queue previews", () => {
    expect(isPromptBusy({ activity: "talking" })).toBe(true);
    expect(isPromptBusy({ activity: "awaiting-choice" })).toBe(true);
    expect(isAgentKind("codex")).toBe(true);
    expect(isAgentKind("ssh")).toBe(false);
    expect(promptPreview("第一行\n   第二行", 10)).toBe("第一行 第二行");
    expect(promptPreview("abcdefghijkl", 8)).toBe("abcdefg…");
  });
});
