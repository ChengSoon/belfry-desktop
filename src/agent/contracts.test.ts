import { describe, expect, it } from "vitest";
import {
  agentDescriptor,
  agentProfileId,
  agentResetCommand,
  AGENT_KINDS,
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
        structuredState: true,
      },
    });
  });

  it("rejects unknown adapter kinds at the boundary", () => {
    expect(isAgentKind("codex")).toBe(true);
    for (const kind of AGENT_KINDS) expect(isAgentKind(kind)).toBe(true);
    for (const kind of ["unknown", "agy", "__proto__", "toString", null]) expect(isAgentKind(kind)).toBe(false);
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
    for (const agent of AGENT_KINDS) expect(isAgentSessionRef({ agent, id: "session-1" })).toBe(true);
    expect(isAgentSessionRef({ agent: "unknown", id: "session-1" })).toBe(false);
  });

  it("maps each agent to its own context reset command", () => {
    // 房间「清除上下文」按这张表发送：认错了会把无关文本打进别人的终端。
    expect(agentResetCommand("claude")).toBe("/clear");
    expect(agentResetCommand("codex")).toBe("/new");
    expect(agentResetCommand("pi")).toBeNull();
    for (const kind of ["antigravity", "opencode", "kimi"] as const) expect(agentResetCommand(kind)).toBe("/new");
    expect(agentDescriptor("antigravity")).toMatchObject({ id: "agent:antigravity", command: "agy" });
  });
});
