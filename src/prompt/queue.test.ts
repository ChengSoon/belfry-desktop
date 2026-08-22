import { describe, expect, it, vi } from "vitest";
import {
  createPromptQueueItem,
  nextPrompt,
  promptsForRun,
  removePrompt,
  removePromptsForRun,
  removePromptsForTab,
} from "./queue";

describe("prompt queue helpers", () => {
  it("creates stable queue records and keeps the full prompt text", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "prompt-1" });
    expect(createPromptQueueItem("tab-1", "第一行\n第二行", 123)).toEqual({
      id: "prompt-1",
      tabId: "tab-1",
      text: "第一行\n第二行",
      createdAt: 123,
      origin: null,
    });
    expect(createPromptQueueItem("tab-1", "步骤", 123, { runId: "run-1", stepId: "step-1" }).origin)
      .toEqual({ runId: "run-1", stepId: "step-1" });
    vi.unstubAllGlobals();
  });

  it("finds the first prompt for a target and removes only requested records", () => {
    const items = [
      { id: "a", tabId: "tab-1", text: "a", createdAt: 1, origin: null },
      { id: "b", tabId: "tab-2", text: "b", createdAt: 2, origin: null },
      { id: "c", tabId: "tab-1", text: "c", createdAt: 3, origin: null },
    ];
    expect(nextPrompt(items, "tab-1")?.id).toBe("a");
    expect(removePrompt(items, "b").map((item) => item.id)).toEqual(["a", "c"]);
    expect(removePromptsForTab(items, "tab-1").map((item) => item.id)).toEqual(["b"]);
  });

  it("isolates one recipe run from another run and from manual prompts", () => {
    const items = [
      { id: "a", tabId: "tab-1", text: "a", createdAt: 1, origin: { runId: "run-1", stepId: "s1" } },
      { id: "b", tabId: "tab-1", text: "b", createdAt: 2, origin: null },
      { id: "c", tabId: "tab-1", text: "c", createdAt: 3, origin: { runId: "run-2", stepId: "s1" } },
      { id: "d", tabId: "tab-1", text: "d", createdAt: 4, origin: { runId: "run-1", stepId: "s2" } },
    ];
    expect(promptsForRun(items, "run-1").map((item) => item.id)).toEqual(["a", "d"]);
    expect(removePromptsForRun(items, "run-1").map((item) => item.id)).toEqual(["b", "c"]);
  });
});
