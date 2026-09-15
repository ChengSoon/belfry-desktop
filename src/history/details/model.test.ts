import { expect, it } from "vitest";
import { cachePage, pageChanges, resultLabel } from "./model";
import type { DetailPage, HistoryEntry } from "./contracts";

export const call: HistoryEntry = { id: "0:10", role: "assistant", timestamp: 1, text: "分两步修改", omittedBlocks: 0, truncated: false,
  tools: [{ id: "edit-one", name: "MultiEdit", kind: "call", text: "{}", success: null, changes: [
    { path: "中文 项目/a.ts", originalPath: null, kind: "edit", oldText: "旧", newText: "中", patch: null, note: "替换片段" },
    { path: "中文 项目/a.ts", originalPath: null, kind: "edit", oldText: "中", newText: "新", patch: null, note: "替换片段" },
  ] }] };

it("同一文件每次修改保留独立顺序和来源消息，失败不显示为成功", () => {
  const result: HistoryEntry = { ...call, id: "0:11", role: "tool", tools: [{ ...call.tools[0], kind: "result", success: false, changes: [] }] };
  const records = pageChanges([call, result]);
  expect(records).toHaveLength(2); expect(records[0].id).not.toBe(records[1].id);
  expect(records.map((record) => record.entryId)).toEqual(["0:10", "0:10"]);
  expect(records.map((record) => record.change.newText)).toEqual(["中", "新"]);
  expect(resultLabel(records[0])).toBe("工具返回失败");
  expect(resultLabel(pageChanges([call])[0])).toBe("本页未见执行结果");
});

it("缺失执行状态不会被当作成功，已有结果和无结果有区别", () => {
  expect(resultLabel({ success: null, resultPresent: true })).toBe("执行状态未标明");
  expect(resultLabel({ success: true, resultPresent: true })).toBe("工具返回成功");
});

it("缓存有界且重试同一页不会新增重复页面", () => {
  let pages: DetailPage[] = [];
  const item = (page: number): DetailPage => ({ readerId: "reader", page, entries: [], hasMore: true, scannedBytes: 0, totalBytes: 0, skippedLines: 0, note: null });
  for (let index = 0; index < 50; index += 1) pages = cachePage(pages, item(index));
  expect(pages).toHaveLength(32); expect(pages[0].page).toBe(18);
  expect(cachePage(pages, item(49))).toHaveLength(32);
});
