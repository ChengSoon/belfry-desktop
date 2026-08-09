import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTab, groupTabsByProject, nextActiveTab, nextOrdinal } from "./tabs";

const project = { id: "p1", name: "demo", rootPath: "/demo", rootUri: "file:///demo" };
const other = { id: "p2", name: "other", rootPath: "/other", rootUri: "file:///other" };

describe("workspace tabs", () => {
  it("maps fixed agent kinds to fixed launch profiles", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "tab-1" });
    expect(createWorkspaceTab(project, "codex", 1)).toMatchObject({
      id: "tab-1",
      project,
      profileId: "agent:codex",
      title: "Codex 01",
    });
    vi.unstubAllGlobals();
  });

  it("selects a surviving neighbor when the active tab closes", () => {
    const tabs = ["a", "b", "c"].map((id) => ({
      ...createWorkspaceTab(project, "shell", 1),
      id,
    }));
    expect(nextActiveTab(tabs, "b").activeId).toBe("c");
  });
});

describe("project grouping", () => {
  it("groups sessions by project in first-seen order", () => {
    const tabs = [
      { ...createWorkspaceTab(project, "shell", 1), id: "a" },
      { ...createWorkspaceTab(other, "shell", 2), id: "b" },
      { ...createWorkspaceTab(project, "claude", 1), id: "c" },
    ];
    const groups = groupTabsByProject(tabs);
    expect(groups.map((group) => group.project.id)).toEqual(["p1", "p2"]);
    expect(groups[0].tabs.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(groups[1].tabs.map((tab) => tab.id)).toEqual(["b"]);
  });

  it("numbers sessions per kind across every project", () => {
    const tabs = [
      createWorkspaceTab(project, "shell", 1),
      createWorkspaceTab(other, "shell", 2),
    ];
    // 第三个 shell 落在别的项目里也接着排 03，避免组间出现重名会话
    expect(nextOrdinal(tabs, "shell")).toBe(3);
    expect(nextOrdinal(tabs, "claude")).toBe(1);
  });
});
