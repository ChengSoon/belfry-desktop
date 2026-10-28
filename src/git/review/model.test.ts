import { describe, expect, it } from "vitest";
import type { WorkspaceTab } from "../../workspace/contracts";
import type { GitDiff } from "../contracts";
import { buildReviewPrompt, createReviewAnchor, isReviewAnchorCurrent, MAX_REVIEW_COMMENT, reviewLineLabel,
  reviewTargets, type ReviewContext } from "./model";

const diff: GitDiff = { text: "diff --git a/old.ts b/new.ts\n--- a/old.ts\n+++ b/new.ts\n@@ -10,2 +10,2 @@\n-old();\n+newCall();\n context();\n", binary: false, truncated: false };
const context: ReviewContext = { projectRoot: "/work/project", request: { rootPath: "/work/project", path: "新 文件.ts", stage: "staged" }, originalPath: "旧 文件.ts" };
const tab = (id: string, rootPath: string, fields: Partial<WorkspaceTab> = {}) => ({ id, project: { rootPath },
  kind: "codex", phase: "running", activity: "idle", ...fields }) as WorkspaceTab;

describe("Git review context", () => {
  it("offers only live agents in the exact project, including busy agents but excluding sibling worktrees", () => {
    const candidates = [tab("same", "/work/project"), tab("busy", "/work/project", { activity: "awaiting-choice" }),
      tab("sibling", "/work/project-task"), tab("child", "/work/project/nested"),
      tab("shell", "/work/project", { kind: "shell" }), tab("closed", "/work/project", { phase: "exited" })];
    expect(reviewTargets(candidates, "/work/project").map((item) => item.id)).toEqual(["same", "busy"]);
    expect(reviewTargets([tab("windows", "C:\\Work\\Project")], "c:/work/project/")).toHaveLength(1);
  });

  it("preserves deleted-line coordinates, stage and rename paths in the agent feedback", () => {
    const anchor = createReviewAnchor(diff, 4)!;
    expect(reviewLineLabel(anchor.line)).toBe("旧第 10 行（已删除）");
    const payload = JSON.parse(buildReviewPrompt(context, anchor, "保留这个检查。\n再补测试。").split("\n\n").at(-1)!);
    expect(payload).toMatchObject({ file: "新 文件.ts", previousFile: "旧 文件.ts", stage: "staged",
      selectedLine: { kind: "remove", oldLine: 10, newLine: null }, feedback: "保留这个检查。\n再补测试。" });
    expect(payload.diffExcerpt.some((line: { text: string }) => line.text === "+newCall();")).toBe(true);
  });

  it("invalidates moved or changed lines and changed nearby context instead of silently retargeting", () => {
    const anchor = createReviewAnchor(diff, 5)!;
    expect(isReviewAnchorCurrent(diff, anchor)).toBe(true);
    expect(isReviewAnchorCurrent({ ...diff, text: diff.text.replace("newCall()", "changed()") }, anchor)).toBe(false);
    expect(isReviewAnchorCurrent({ ...diff, text: diff.text.replace("-10,2 +10,2", "-11,2 +11,2") }, anchor)).toBe(false);
    expect(isReviewAnchorCurrent({ ...diff, text: diff.text.replace("context()", "otherContext()") }, anchor)).toBe(false);
    expect(isReviewAnchorCurrent(null, anchor)).toBe(false);
  });

  it("does not offer feedback anchors for headers, combined conflict hunks, binary or missing lines", () => {
    expect(createReviewAnchor(diff, 0)).toBeNull();
    expect(createReviewAnchor(diff, -1)).toBeNull();
    expect(createReviewAnchor(diff, 99)).toBeNull();
    expect(createReviewAnchor({ ...diff, binary: true }, 5)).toBeNull();
    expect(createReviewAnchor({ ...diff, text: "@@@ -1 -1 +1 @@@\n++conflict\n" }, 1)).toBeNull();
  });

  it("escapes terminal control bytes in filenames, code and comments while retaining their JSON meaning", () => {
    const special = { ...diff, text: diff.text.replace("newCall()", "\u001b[2J<script>`code`</script>") };
    const anchor = createReviewAnchor(special, 5)!;
    const prompt = buildReviewPrompt({ ...context, request: { ...context.request, path: "odd\n\u001b.ts" } }, anchor, "意见\u001b[1A");
    expect(prompt).not.toContain("\u001b");
    const payload = JSON.parse(prompt.split("\n\n").at(-1)!);
    expect(payload.file).toBe("odd\n\u001b.ts");
    expect(payload.feedback).toBe("意见\u001b[1A");
  });

  it("bounds feedback and excerpts instead of sending an entire large diff", () => {
    const large = { ...diff, text: "@@ -1 +1 @@\n-old\n+" + "x".repeat(50_000) + "\n" };
    const anchor = createReviewAnchor(large, 2)!;
    expect(buildReviewPrompt(context, anchor, "检查这一行").length).toBeLessThan(4_000);
    expect(() => buildReviewPrompt(context, anchor, " ")).toThrow();
    expect(() => buildReviewPrompt(context, anchor, "x".repeat(MAX_REVIEW_COMMENT + 1))).toThrow();
    expect(isReviewAnchorCurrent({ ...large, text: large.text.replace(/x\n$/, "y\n") }, anchor)).toBe(false);
  });
});
