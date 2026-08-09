import { describe, expect, it } from "vitest";
import { parseRecentProjects, rememberProject } from "./storage";

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
