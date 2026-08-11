import { describe, expect, it } from "vitest";
import {
  parseRecentProjects,
  parseWorkspaceState,
  rememberProject,
  serializeWorkspaceState,
} from "./storage";
import { createWorkspaceTab } from "./tabs";

describe("recent projects", () => {
  it("deduplicates and caps project history", () => {
    const project = { id: "p0", name: "zero", rootPath: "/zero", rootUri: "file:///zero" };
    const recent = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index}`,
      name: `project-${index}`,
      rootPath: index === 0 ? "/zero" : `/project-${index}`,
    }));
    const result = rememberProject(project, recent);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ id: "p0", name: "zero", rootPath: "/zero" });
    expect(result.filter((item) => item.rootPath === "/zero")).toHaveLength(1);
  });

  it("drops malformed persisted entries", () => {
    expect(parseRecentProjects('[{"id":"ok","name":"demo","rootPath":"/demo"},{"id":2}]'))
      .toEqual([{ id: "ok", name: "demo", rootPath: "/demo" }]);
  });

  it("deduplicates persisted paths after project id migrations", () => {
    const persisted = JSON.stringify([
      { id: "new-id", name: "demo", rootPath: "/demo" },
      { id: "legacy-id", name: "demo", rootPath: "/demo" },
    ]);
    expect(parseRecentProjects(persisted)).toEqual([
      { id: "new-id", name: "demo", rootPath: "/demo" },
    ]);
  });
});

describe("workspace session persistence", () => {
  const project = { id: "p1", name: "demo", rootPath: "/demo", rootUri: "file:///demo" };

  it("restores session order, titles, projects, kinds, and the active session", () => {
    const shell = { ...createWorkspaceTab(project, "shell", 1), id: "shell-1" };
    const codex = {
      ...createWorkspaceTab(project, "codex", 1),
      id: "codex-1",
      title: "修复登录",
      titleHint: "帮我修复登录",
      phase: "error" as const,
      activity: "awaiting-choice" as const,
      error: "old failure",
    };

    const restored = parseWorkspaceState(serializeWorkspaceState([shell, codex], codex.id));
    expect(restored?.tabs.map((tab) => tab.id)).toEqual(["shell-1", "codex-1"]);
    expect(restored?.activeTabId).toBe("codex-1");
    expect(restored?.tabs[1]).toMatchObject({
      project,
      kind: "codex",
      profileId: "agent:codex",
      title: "修复登录",
      titleHint: "帮我修复登录",
      phase: "idle",
      activity: "idle",
      error: null,
    });
  });

  it("keeps an intentionally empty session list", () => {
    expect(parseWorkspaceState(serializeWorkspaceState([], null))).toEqual({
      tabs: [],
      activeTabId: null,
    });
  });

  it("drops malformed and duplicate sessions and repairs the active id", () => {
    const persisted = JSON.stringify({
      tabs: [
        { id: "one", project, kind: "shell", title: "Shell 01", titleHint: null },
        { id: "one", project, kind: "claude", title: "duplicate", titleHint: null },
        { id: "bad", project, kind: "unknown", title: "bad", titleHint: null },
      ],
      activeTabId: "missing",
    });
    const restored = parseWorkspaceState(persisted);
    expect(restored?.tabs).toHaveLength(1);
    expect(restored?.activeTabId).toBe("one");
  });
});
