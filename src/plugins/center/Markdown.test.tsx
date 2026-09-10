import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("插件市场说明", () => {
  it("显示作者提供的 GFM 表格、任务列表和嵌套列表", () => {
    const result = renderToStaticMarkup(<Markdown source={"| 能力 | 状态 |\n| --- | --- |\n| 导出 | 可用 |\n\n- [x] 完成\n  - 子项\n\n~~旧版~~"} />);
    expect(result).toContain("<table>");
    expect(result).toContain("<td>可用</td>");
    expect(result).toContain('type="checkbox"');
    expect(result).toContain("<del>旧版</del>");
  });

  it("过滤说明中的 HTML 与脚本链接", () => {
    const result = renderToStaticMarkup(<Markdown source={'<script>alert(1)</script>\n\n[打开](javascript:alert%281%29)'} />);
    expect(result).not.toContain("<script>");
    expect(result).not.toContain('href="javascript:');
  });
});
