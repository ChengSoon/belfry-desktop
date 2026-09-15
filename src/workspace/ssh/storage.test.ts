import { describe, expect, it } from "vitest";
import { loadHosts, persistHosts } from "./storage";

function memory(initial: string | null = null) {
  let raw = initial;
  return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
}

describe("SSH 档案存储", () => {
  it("重读已保存档案，拒绝并发覆盖", () => {
    const storage = memory(), catalog = { version: 1 as const, entries: [] };
    const raw = persistHosts(catalog, { expectedRaw: null, storage });
    expect(loadHosts(storage)).toEqual({ catalog, raw, error: null });
    expect(() => persistHosts(catalog, { expectedRaw: null, storage })).toThrow(/其他窗口/);
  });
  it("保留损坏原文并报错，不以空存档覆盖", () => {
    const storage = memory("broken");
    expect(loadHosts(storage).error).toBeTruthy();
    expect(() => persistHosts({ version: 1, entries: [] }, { expectedRaw: "broken", storage })).toThrow();
    expect(storage.getItem()).toBe("broken");
  });
});
