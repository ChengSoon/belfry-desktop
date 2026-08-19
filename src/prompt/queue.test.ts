import { describe, expect, it, vi } from "vitest";
import { createPromptQueueItem, nextPrompt, removePrompt, removePromptsForTab } from "./queue";

describe("prompt queue helpers", () => {
  it("creates stable queue records and keeps the full prompt text", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "prompt-1" });
    expect(createPromptQueueItem("tab-1", "第一行\n第二行", 123)).toEqual({
      id: "prompt-1",
      tabId: "tab-1",
      text: "第一行\n第二行",
      createdAt: 123,
    });
    vi.unstubAllGlobals();
  });

  it("finds the first prompt for a target and removes only requested records", () => {
    const items = [
      { id: "a", tabId: "tab-1", text: "a", createdAt: 1 },
      { id: "b", tabId: "tab-2", text: "b", createdAt: 2 },
      { id: "c", tabId: "tab-1", text: "c", createdAt: 3 },
    ];
    expect(nextPrompt(items, "tab-1")?.id).toBe("a");
    expect(removePrompt(items, "b").map((item) => item.id)).toEqual(["a", "c"]);
    expect(removePromptsForTab(items, "tab-1").map((item) => item.id)).toEqual(["b"]);
  });
});
