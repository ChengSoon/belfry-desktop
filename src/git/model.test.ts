import { expect, it } from "vitest";
import { groupChanges, parseUnifiedDiff } from "./model";
import type { GitEntry } from "./contracts";

const entry = (patch: Partial<GitEntry>): GitEntry => ({
  path: "src/接口.ts", originalPath: null, indexStatus: ".", worktreeStatus: ".",
  untracked: false, conflicted: false, submodule: false, ...patch,
});

it("同一文件的暂存区和工作区变更分别可选，冲突不重复计入", () => {
  const groups = groupChanges([
    entry({ indexStatus: "M", worktreeStatus: "M" }),
    entry({ path: "new.txt", untracked: true, indexStatus: "?", worktreeStatus: "?" }),
    entry({ path: "conflict.txt", conflicted: true, indexStatus: "U", worktreeStatus: "U" }),
  ]);
  expect(groups.map(({ id, files }) => [id, files.length])).toEqual([
    ["conflicts", 1], ["staged", 1], ["unstaged", 1], ["untracked", 1],
  ]);
});

it("以各 hunk 的起点计算新旧行号，正确处理空白行和无末尾换行", () => {
  const patch = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -3,2 +3,3 @@\n same\n-old\n+new\n+\n\\ No newline at end of file\n@@ -9 +10 @@\n-tail\n+end\n";
  const { lines } = parseUnifiedDiff(patch);
  expect(lines.filter(({ kind }) => kind === "add").map(({ text, oldLine, newLine }) => [text, oldLine, newLine]))
    .toEqual([["+new", null, 4], ["+", null, 5], ["+end", null, 10]]);
  expect(lines.find(({ text }) => text === "-tail")?.oldLine).toBe(9);
});

it("保留原始空格、HTML 和过长 diff 的分页边界", () => {
  const patch = "@@ -1 +1,2 @@\n- old\n+ <script>alert(1)</script>\n+  spaces\n";
  const parsed = parseUnifiedDiff(patch, 3);
  expect(parsed.lines.at(-1)?.text).toBe("+ <script>alert(1)</script>");
  expect(parsed.more).toBe(true);
});
