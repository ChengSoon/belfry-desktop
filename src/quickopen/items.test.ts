import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTab } from "../workspace/tabs";
import { buildQuickOpenItems } from "./items";

const project = { id: "p1", name: "belfry", rootPath: "/work/belfry", rootUri: "file:///work/belfry" };

describe("buildQuickOpenItems", () => {
  it("maps active sessions and recent projects to stable action payloads", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "tab-1" });
    const tab = { ...createWorkspaceTab(project, "codex", 1), title: "修复搜索" };
    const items = buildQuickOpenItems(
      [tab],
      [{ id: project.id, name: project.name, rootPath: project.rootPath }],
      tab.id,
    );

    expect(items[0]).toMatchObject({
      id: "session:tab-1",
      kind: "session",
      title: "修复搜索",
      subtitle: "Codex · belfry · 当前",
      value: "tab-1",
    });
    expect(items[1]).toMatchObject({
      id: "project:p1",
      kind: "project",
      value: "/work/belfry",
    });
    vi.unstubAllGlobals();
  });

  it("keeps every built-in action id unique", () => {
    const actionIds = buildQuickOpenItems([], [], null)
      .filter((item) => item.kind === "action")
      .map((item) => item.id);
    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(actionIds).toContain("action:new-shell");
    expect(actionIds).toContain("action:composer");
    expect(actionIds).toContain("action:shortcuts");
  });
});
