import { describe, expect, it } from "vitest";
import { searchQuickOpen, type QuickOpenItem } from "./model";

const items: QuickOpenItem[] = [
  { id: "session-codex", kind: "session", title: "修复登录超时", subtitle: "Codex · ~/work/app" },
  { id: "session-shell", kind: "session", title: "Shell 01", subtitle: "bash · ~/work/app", keywords: ["终端"] },
  { id: "project-app", kind: "project", title: "belfry", subtitle: "/Users/me/work/belfry" },
  { id: "action-settings", kind: "action", title: "打开设置", subtitle: "应用", keywords: ["preferences", "config"] },
];

describe("searchQuickOpen", () => {
  it("returns the source order for an empty query and keeps disabled items out", () => {
    const result = searchQuickOpen([
      ...items,
      { id: "disabled", kind: "action", title: "不可用", subtitle: "", disabled: true },
    ], "");
    expect(result.map(({ item }) => item.id)).toEqual(items.map((item) => item.id));
  });

  it("prefers exact and title matches over lower-priority fields", () => {
    const result = searchQuickOpen(items, "设置");
    expect(result[0].item.id).toBe("action-settings");
  });

  it("matches Chinese text and case-insensitive subsequences", () => {
    expect(searchQuickOpen(items, "登录")[0].item.id).toBe("session-codex");
    expect(searchQuickOpen(items, "BFRY")[0].item.id).toBe("project-app");
    expect(searchQuickOpen(items, "终端")[0].item.id).toBe("session-shell");
  });

  it("requires every query term and preserves stable order for ties", () => {
    expect(searchQuickOpen(items, "打开 不存在")).toEqual([]);
    const tied = items.slice(0, 2).map((item) => ({ ...item, title: "abc", subtitle: "same" }));
    expect(searchQuickOpen(tied, "abc").map(({ item }) => item.id)).toEqual([
      "session-codex",
      "session-shell",
    ]);
  });
});
