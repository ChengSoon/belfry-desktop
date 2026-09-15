import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { GitDiffContent } from "./GitDiffView";
import { GitFileList } from "./GitFileList";
import { groupChanges } from "./model";
import type { GitEntry } from "./contracts";

const noop = () => {};
const renamed: GitEntry = {
  path: "src/新 文件.ts", originalPath: "src/旧文件.ts", indexStatus: "R", worktreeStatus: ".",
  untracked: false, conflicted: false, submodule: false,
};

it("按区域展示改动、重命名前路径和文件预览入口", () => {
  const html = renderToStaticMarkup(<GitFileList groups={groupChanges([renamed])} query=""
    selected={{ rootPath: "/work", path: renamed.path, stage: "staged" }} onQuery={noop} onSelect={noop} onOpen={noop} />);
  expect(html).toContain("已暂存");
  expect(html).toContain("src/旧文件.ts");
  expect(html).toContain('aria-label="预览文件 src/新 文件.ts"');
  expect(html).toContain('aria-pressed="true"');
});

it("Diff 渲染保留行号与增删语义，并转义源码中的 HTML", () => {
  const html = renderToStaticMarkup(<GitDiffContent diff={{
    text: "@@ -3 +3 @@\n-old\n+<script>alert(1)</script>\n", binary: false, truncated: false,
  }} />);
  expect(html).toContain("git-line--remove");
  expect(html).toContain("git-line--add");
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("<td>3</td>");
});

it("二进制、空差异和截断分别给出明确提示", () => {
  const render = (patch: Partial<Parameters<typeof GitDiffContent>[0]["diff"]>) => renderToStaticMarkup(
    <GitDiffContent diff={{ text: "", binary: false, truncated: false, ...patch }} />);
  expect(render({ binary: true })).toContain("二进制文件");
  expect(render({})).toContain("当前已无该类差异");
  expect(render({ text: "diff --git a/a b/a\n", truncated: true })).toContain("内容不完整");
});
