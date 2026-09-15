import type { DiffStage, GitEntry } from "./contracts";

export const DIFF_PAGE_LINES = 500;
export interface ChangeGroup { id: string; title: string; stage: DiffStage; files: GitEntry[] }
export interface DiffLine {
  kind: "hunk" | "add" | "remove" | "context" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export function groupChanges(entries: GitEntry[]): ChangeGroup[] {
  const tracked = entries.filter((entry) => !entry.untracked && !entry.conflicted);
  return [
    { id: "conflicts", title: "合并冲突", stage: "unstaged", files: entries.filter((entry) => entry.conflicted) },
    { id: "staged", title: "已暂存", stage: "staged", files: tracked.filter((entry) => entry.indexStatus !== ".") },
    { id: "unstaged", title: "未暂存", stage: "unstaged", files: tracked.filter((entry) => entry.worktreeStatus !== ".") },
    { id: "untracked", title: "未跟踪", stage: "untracked", files: entries.filter((entry) => entry.untracked) },
  ];
}

export function parseUnifiedDiff(text: string, limit = DIFF_PAGE_LINES) {
  const records = text.split("\n");
  if (records.at(-1) === "") records.pop();
  const cursor = { oldLine: 0, newLine: 0, hunk: false };
  const lines = records.slice(0, limit).map((text) => parseLine(text, cursor));
  return { lines, more: records.length > limit, total: records.length };
}

function parseLine(text: string, cursor: { oldLine: number; newLine: number; hunk: boolean }): DiffLine {
  const line: DiffLine = { text, kind: "meta", oldLine: null, newLine: null };
  if (text.startsWith("diff ")) cursor.hunk = false;
  if (text.startsWith("@@")) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(text);
    cursor.hunk = Boolean(match);
    if (match) { cursor.oldLine = Number(match[1]); cursor.newLine = Number(match[2]); }
    return { ...line, kind: "hunk" };
  }
  if (!cursor.hunk) return line;
  if (text.startsWith("+")) return { ...line, kind: "add", newLine: cursor.newLine++ };
  if (text.startsWith("-")) return { ...line, kind: "remove", oldLine: cursor.oldLine++ };
  if (text.startsWith(" ")) return { ...line, kind: "context", oldLine: cursor.oldLine++, newLine: cursor.newLine++ };
  return line;
}

export function canPreview(entry: GitEntry) {
  return !entry.submodule && entry.worktreeStatus !== "D" && entry.indexStatus !== "D";
}

export function statusLabel(entry: GitEntry, stage: DiffStage) {
  if (entry.conflicted) return "冲突";
  if (entry.untracked) return "新增";
  const code = stage === "staged" ? entry.indexStatus : entry.worktreeStatus;
  return ({ M: "修改", A: "新增", D: "删除", R: "重命名", C: "复制", T: "类型变更", U: "冲突" } as Record<string, string>)[code] ?? code;
}
