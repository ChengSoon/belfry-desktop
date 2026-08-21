import { describe, expect, it, vi } from "vitest";
import { RECIPES_KEY, loadRecipes, parseRecipes, saveRecipes } from "./storage";

const valid = {
  id: "recipe-1",
  name: "发布前检查",
  description: "跑测试并写变更",
  steps: [{ id: "s1", text: "跑 pnpm test" }],
  createdAt: 1,
  updatedAt: 2,
};

describe("parseRecipes", () => {
  it("returns an empty list for absent or malformed payloads", () => {
    expect(parseRecipes(null)).toEqual([]);
    expect(parseRecipes("")).toEqual([]);
    expect(parseRecipes(JSON.stringify({ notAnArray: true }))).toEqual([]);
  });

  it("keeps valid entries and drops broken ones instead of failing the whole file", () => {
    const payload = JSON.stringify([
      valid,
      { ...valid, id: "recipe-2", name: "" },
      { ...valid, id: "recipe-3", steps: [] },
      { ...valid, id: "recipe-4", steps: [{ id: "", text: "x" }] },
      { ...valid, id: "recipe-5", createdAt: "nope" },
      { ...valid, id: "recipe-6", updatedAt: Number.NaN },
      { ...valid, id: "recipe-7" },
    ]);
    expect(parseRecipes(payload).map((item) => item.id)).toEqual(["recipe-1", "recipe-7"]);
  });

  it("deduplicates by id and normalizes a missing description to null", () => {
    const payload = JSON.stringify([
      { ...valid, description: undefined },
      { ...valid, name: "重复 id" },
    ]);
    const parsed = parseRecipes(payload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].description).toBeNull();
    expect(parsed[0].name).toBe("发布前检查");
  });

  it("accepts a step whose text is empty, since the editor allows blank drafts", () => {
    const payload = JSON.stringify([{ ...valid, steps: [{ id: "s1", text: "" }] }]);
    expect(parseRecipes(payload)).toHaveLength(1);
  });
});

describe("recipe storage round trip", () => {
  it("survives save and load", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };

    saveRecipes([valid], storage);
    expect(store.has(RECIPES_KEY)).toBe(true);
    expect(loadRecipes(storage)).toEqual([valid]);
  });

  it("degrades quietly when storage throws or holds garbage", () => {
    const throwing = {
      getItem: () => "{ not json",
      setItem: () => {
        throw new Error("disabled");
      },
    };
    expect(loadRecipes(throwing)).toEqual([]);
    expect(() => saveRecipes([valid], throwing)).not.toThrow();
  });

  it("caps how many recipes are written", () => {
    const setItem = vi.fn();
    const many = Array.from({ length: 60 }, (_, index) => ({ ...valid, id: `recipe-${index}` }));
    saveRecipes(many, { setItem });
    expect(JSON.parse(setItem.mock.calls[0][1] as string)).toHaveLength(40);
  });
});
