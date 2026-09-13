import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_HISTORY_FILTERS, filterHistoryMetadata, highlightedParts, toHistoryQuery } from "./search";
import type { HistorySearchHit } from "./search";

afterEach(() => vi.unstubAllEnvs());

function hit(agent: "codex" | "claude", id: string): HistorySearchHit {
  return { session: {
    agent, id, title: "开发", cwd: "/work/a", startedAt: 1, lastActiveAt: 2, sessionRef: { agent, id },
  }, snippet: "结果" };
}

describe("history query", () => {
  it("uses local inclusive dates instead of shifting them to UTC midnight", () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    const query = toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, startDate: "2026-09-10", endDate: "2026-09-10" });
    expect(query.from).toBe(1_788_969_600);
    expect(query.until).toBe(1_789_056_000);
  });

  it("rejects invalid or reversed dates rather than showing misleading empty results", () => {
    expect(() => toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, startDate: "2026-02-30" })).toThrow();
    expect(() => toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, startDate: "2026-09-12", endDate: "2026-09-10" })).toThrow();
  });

  it("keeps exact project paths and agent selection in the backend query", () => {
    expect(toHistoryQuery({ ...EMPTY_HISTORY_FILTERS, agent: "claude", project: "/工作/项目 A", text: "  编译错误 " }))
      .toEqual({ agent: "claude", projectRoot: "/工作/项目 A", text: "编译错误", from: null, until: null });
  });
});

describe("history presentation", () => {
  it("combines favorite and tag filters without changing resume identity", () => {
    const codex = hit("codex", "same");
    const claude = hit("claude", "same");
    const result = filterHistoryMetadata({
      hits: [codex, claude, hit("claude", "other")],
      metadata: {
        '["codex","same"]': { favorite: true, tags: ["前端"] },
        '["claude","same"]': { favorite: true, tags: ["Review"] },
        '["claude","other"]': { favorite: false, tags: ["Review"] },
      },
      filters: { favoriteOnly: true, tag: "review" },
    });
    expect(result).toEqual([claude]);
    expect(result[0]?.session.sessionRef).toBe(claude.session.sessionRef);
  });

  it("highlights literal paths safely without treating regex or markup as code", () => {
    const parts = highlightedParts("定位 src/a[1].ts，SRC/A[1].TS <b>原文</b>", "src/a[1].ts");
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["src/a[1].ts", "SRC/A[1].TS"]);
    expect(parts.map((part) => part.text).join("")).toBe("定位 src/a[1].ts，SRC/A[1].TS <b>原文</b>");
  });
});
