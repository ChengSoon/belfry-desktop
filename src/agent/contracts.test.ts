import { describe, expect, it } from "vitest";
import {
  agentDescriptor,
  agentProfileId,
  isAgentKind,
  isAgentSessionRef,
} from "./contracts";

describe("agent adapter contracts", () => {
  it("keeps the two built-in descriptors capability-compatible", () => {
    expect(agentProfileId("codex")).toBe("agent:codex");
    expect(agentDescriptor("claude")).toMatchObject({
      id: "agent:claude",
      kind: "claude",
      capabilities: {
        launch: true,
        resume: true,
        history: true,
        prompt: true,
        structuredState: false,
      },
    });
  });

  it("rejects unknown adapter kinds at the boundary", () => {
    expect(isAgentKind("codex")).toBe(true);
    expect(isAgentKind("opencode")).toBe(false);
  });

  it("validates opaque session references without accepting path-like ids", () => {
    expect(isAgentSessionRef({ agent: "codex", id: "session-1" })).toBe(true);
    for (const id of [
      "",
      ".",
      "../session",
      "a\\b",
      "line\nbreak",
      "nul\0byte",
      "x".repeat(513),
      "会".repeat(171),
    ]) {
      expect(isAgentSessionRef({ agent: "codex", id })).toBe(false);
    }
    expect(isAgentSessionRef({ agent: "codex", id: "会".repeat(170) })).toBe(true);
    expect(isAgentSessionRef({ agent: "opencode", id: "session-1" })).toBe(false);
  });
});
