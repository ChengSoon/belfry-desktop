import { describe, expect, it } from "vitest";
import {
  CONTEXT_BODY_MAX,
  CONTEXT_INLINE_MAX,
  CONTEXT_TAGS_MAX,
  CONTEXT_TITLE_MAX,
  contextReference,
  createContextItem,
  normalizeTags,
  normalizeTitle,
  parseContextItem,
  parseContextItems,
  shouldInline,
  type ContextItem,
} from "./contracts";

function item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: "c1",
    kind: "note",
    title: "约定",
    body: "只改路由字段",
    path: null,
    source: { from: "user" },
    tags: [],
    pinned: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("inline threshold", () => {
  it("短内容内联，长内容落盘", () => {
    expect(shouldInline("a".repeat(CONTEXT_INLINE_MAX))).toBe(true);
    expect(shouldInline("a".repeat(CONTEXT_INLINE_MAX + 1))).toBe(false);
  });

  it("超阈值的正文不进 body，等存储层落盘后补 path", () => {
    const created = createContextItem({
      kind: "artifact",
      title: "长产物",
      body: "x".repeat(CONTEXT_INLINE_MAX + 1),
      source: { from: "user" },
    });
    expect(created.body).toBeNull();
    expect(created.path).toBeNull();
  });
});

describe("contextReference", () => {
  it("有路径时只给路径，省 token 让 Agent 自己读", () => {
    expect(contextReference(item({ body: null, path: ".belfry/context/c1.md" })))
      .toBe("@.belfry/context/c1.md");
  });

  it("路径优先于正文：两者都在时不重复塞内容", () => {
    expect(contextReference(item({ body: "内联", path: "a.md" }))).toBe("@a.md");
  });

  it("内联项给标题加正文", () => {
    expect(contextReference(item())).toBe("【约定】\n只改路由字段");
  });
});

describe("normalizeTitle", () => {
  it("标题为空时从正文兜一个", () => {
    expect(normalizeTitle("", "  从   正文   提取 ")).toBe("从 正文 提取");
  });

  it("正文也为空时给占位，避免列表里出现认不出的条目", () => {
    expect(normalizeTitle("", "")).toBe("未命名");
  });

  it("超长截断", () => {
    const title = normalizeTitle("标".repeat(CONTEXT_TITLE_MAX + 20));
    expect(title).toHaveLength(CONTEXT_TITLE_MAX);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("normalizeTags", () => {
  it("去空白、去重、限量", () => {
    expect(normalizeTags([" a ", "a", "", "b"])).toEqual(["a", "b"]);
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`)))
      .toHaveLength(CONTEXT_TAGS_MAX);
  });
});

describe("parseContextItem", () => {
  it("接受合法条目", () => {
    expect(parseContextItem(item())).toMatchObject({ id: "c1", kind: "note" });
  });

  it("正文和路径全空的条目丢弃：引用它只会产生空串", () => {
    expect(parseContextItem({ ...item(), body: null, path: null })).toBeNull();
    expect(parseContextItem({ ...item(), body: null, path: "   " })).toBeNull();
  });

  it("拒绝未知 kind 和坏 source", () => {
    expect(parseContextItem({ ...item(), kind: "whatever" })).toBeNull();
    expect(parseContextItem({ ...item(), source: { from: "terminal" } })).toBeNull();
    expect(parseContextItem({ ...item(), source: { from: "nope" } })).toBeNull();
  });

  it("接受各种合法 source", () => {
    const sources = [
      { from: "user" },
      { from: "terminal", tabId: "t1" },
      { from: "agent", tabId: "t1", agent: "codex" },
      { from: "history", session: { agent: "claude", id: "s1" } },
    ];
    for (const source of sources) {
      expect(parseContextItem({ ...item(), source })).not.toBeNull();
    }
  });

  it("挡住超大正文", () => {
    expect(parseContextItem({ ...item(), body: "x".repeat(CONTEXT_BODY_MAX + 1) })).toBeNull();
  });

  it("时间戳缺失时补齐，updatedAt 跟随 createdAt", () => {
    const parsed = parseContextItem({ ...item(), createdAt: 42, updatedAt: "坏" });
    expect(parsed).toMatchObject({ createdAt: 42, updatedAt: 42 });
  });
});

describe("parseContextItems", () => {
  it("坏掉的单条丢弃，不废掉整份索引", () => {
    const parsed = parseContextItems([
      item({ id: "a" }),
      { id: "b", kind: "bad" },
      item({ id: "c" }),
    ]);
    expect(parsed.map((entry) => entry.id)).toEqual(["a", "c"]);
  });

  it("id 去重，保留先出现的那条", () => {
    const parsed = parseContextItems([item({ id: "a", title: "先" }), item({ id: "a", title: "后" })]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe("先");
  });

  it("非数组输入不抛，返回空", () => {
    expect(parseContextItems(null)).toEqual([]);
    expect(parseContextItems({})).toEqual([]);
  });
});
