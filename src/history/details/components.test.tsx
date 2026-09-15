import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { HistoryMessages } from "./HistoryMessages";
import { HistoryChanges, ChangePreview } from "./HistoryChanges";
import { pageChanges } from "./model";
import type { HistoryEntry } from "./contracts";

const entry: HistoryEntry = { id: "0:10", role: "assistant", text: "查看 <script>alert(1)</script> 和 中文/a.ts", timestamp: null,
  omittedBlocks: 1, truncated: true, tools: [{ id: "tool", name: "Edit", kind: "call", text: "old → new", success: null,
    changes: [{ path: "中文/a.ts", kind: "edit", originalPath: null, oldText: "旧文本", newText: "新文本", patch: null, note: "仅替换片段" }] }] };

it("展示消息、工具和截断提示，日志 HTML 始终作为文本", () => {
  const html = renderToStaticMarkup(<HistoryMessages entries={[entry]} selectedId={entry.id} query="中文/a.ts" />);
  for (const text of ["助手", "时间未记录", "Edit", "调用参数", "非文本内容未展开", "部分内容已截断", 'id="history-message-0:10"', "is-target"]) expect(html).toContain(text);
  expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
  expect(html).toContain("<mark>中文/a.ts</mark>");
});

it("历史变更可定位来源消息，并明确失败请求和缺失数据", () => {
  const record = { ...pageChanges([entry])[0], success: false, resultPresent: true };
  const html = renderToStaticMarkup(<HistoryChanges records={[record]} onJump={vi.fn()} />);
  for (const text of ["定位来源消息", "工具返回失败", "不能证明文件已修改", "旧文本", "新文本", "仅替换片段"]) expect(html).toContain(text);
  const missing = renderToStaticMarkup(<ChangePreview change={{ ...record.change, oldText: null, newText: null }} />);
  expect(missing).toContain("原内容未记录"); expect(missing).toContain("新内容未记录");
});

it("无历史 Diff 时说明日志不足，不显示当前磁盘版本", () => {
  const html = renderToStaticMarkup(<HistoryChanges records={[]} onJump={vi.fn()} />);
  expect(html).toContain("日志未保存编辑片段或 patch");
  expect(html).not.toContain("打开当前文件");
});
