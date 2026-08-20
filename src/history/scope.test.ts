import { describe, expect, it } from "vitest";
import {
  advanceHistoryAgentScope,
  isCurrentHistoryAgentScope,
  type HistoryAgentScope,
} from "./scope";

describe("history Agent request scope", () => {
  it("invalidates an operation when the selected Agent changes", () => {
    const codex: HistoryAgentScope = { agent: "codex", generation: 0 };
    const claude = advanceHistoryAgentScope(codex, "claude");
    expect(isCurrentHistoryAgentScope(claude, codex)).toBe(false);
  });

  it("keeps an old operation stale after switching away and back", () => {
    const original: HistoryAgentScope = { agent: "codex", generation: 0 };
    const claude = advanceHistoryAgentScope(original, "claude");
    const current = advanceHistoryAgentScope(claude, "codex");
    expect(current.agent).toBe(original.agent);
    expect(isCurrentHistoryAgentScope(current, original)).toBe(false);
  });

  it("preserves the current token when the Agent does not change", () => {
    const current: HistoryAgentScope = { agent: "codex", generation: 2 };
    expect(advanceHistoryAgentScope(current, "codex")).toBe(current);
  });
});
