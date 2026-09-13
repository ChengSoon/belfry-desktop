import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY_FILTERS, type HistorySearchHit } from "../search";
import { HistorySearchControls } from "./HistorySearchControls";
import { HistoryRow } from "./HistoryRow";

const noop = () => {};
const sample: HistorySearchHit = {
  session: {
    agent: "codex", id: "a", sessionRef: { agent: "codex", id: "a" },
    title: "<script>alert(1)</script>", cwd: "/work/项目", startedAt: 1, lastActiveAt: 2,
  },
  snippet: "修改 src/接口.rs 后测试通过",
};

describe("history search interface", () => {
  it("renders accessible text, project, date and saved-metadata filters", () => {
    const html = renderToStaticMarkup(<HistorySearchControls filters={EMPTY_HISTORY_FILTERS}
      projects={["/work/项目"]} tags={["回归"]} onChange={noop} />);
    for (const label of ["搜索历史正文", "筛选项目", "开始日期", "结束日期", "筛选标签", "只看收藏"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('role="combobox"');
    expect(html).not.toMatch(/<select|type="date"/);
    const selected = renderToStaticMarkup(<HistorySearchControls filters={{ ...EMPTY_HISTORY_FILTERS, project: "/work/项目" }}
      projects={["/work/项目"]} tags={[]} onChange={noop} />);
    expect(selected).toContain("/work/项目");
  });

  it("renders the matched body, keeps resume controls and escapes log markup", () => {
    const html = renderToStaticMarkup(<HistoryRow hit={sample} query="src/接口.rs"
      metadata={{ favorite: true, tags: ["回归"] }} selected={false} selecting={false} busy={false}
      onResume={noop} onInspect={noop} onDelete={noop} onSelect={noop} onFavorite={noop} onTags={noop} onTagFilter={noop} />);
    expect(html).toContain("<mark>src/接口.rs</mark>");
    expect(html).toContain("取消收藏");
    expect(html).toContain("编辑标签");
    expect(html).toContain("继续会话");
    expect(html).toContain("查看会话详情");
    expect(html).toContain("回归");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
