import { describe, expect, it } from "vitest";
import type { ProjectEntry } from "./contracts";
import { filterEntries, parentPath, projectRelativePath } from "./path";

const entries: ProjectEntry[] = [
  { kind: "directory", modifiedAt: null, name: "src", relativePath: "src", size: 0 },
  { kind: "file", modifiedAt: null, name: "README.md", relativePath: "README.md", size: 10 },
];

describe("file preview paths", () => {
  it("moves to parent directories without escaping the root", () => {
    expect(parentPath("src/components")).toBe("src");
    expect(parentPath("src")).toBe("");
    expect(parentPath("")).toBe("");
  });

  it("filters the current directory case-insensitively", () => {
    expect(filterEntries(entries, " read ")).toEqual([entries[1]]);
    expect(filterEntries(entries, "")).toEqual(entries);
  });

  it("normalizes relative, absolute, file URI, and Windows paths", () => {
    expect(projectRelativePath("/work/demo", "src/App.tsx")).toBe("src/App.tsx");
    expect(projectRelativePath("/work/demo", "/work/demo/src/App.tsx")).toBe("src/App.tsx");
    expect(projectRelativePath("/work/demo", "file:///work/demo/src/App.tsx")).toBe("src/App.tsx");
    expect(projectRelativePath("C:\\Work\\Demo", "c:\\work\\demo\\src\\App.tsx"))
      .toBe("src/App.tsx");
    expect(projectRelativePath("/", "src/App.tsx")).toBe("src/App.tsx");
  });

  it("rejects paths outside the project root and root-prefix lookalikes", () => {
    expect(projectRelativePath("/work/demo", "../secret.txt")).toBeNull();
    expect(projectRelativePath("/work/demo", "/work/demo-copy/src/App.tsx")).toBeNull();
  });
});
