import { expect, it } from "vitest";
import { PROJECT_CATALOG_KEY } from "./contracts";
import { createProfile } from "./model";
import { loadProjectCatalog, saveProjectCatalog } from "./storage";

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const catalog = { version: 1 as const, entries: [createProfile({ id: "one", name: "项目", rootPath: "/work/one", rootUri: "file:///work/one" })] };

it("saves and reads profiles without altering unrelated application state", () => {
  const target = storage();
  target.setItem("unrelated", "kept");
  saveProjectCatalog(catalog, { storage: target, expectedRaw: null });
  expect(loadProjectCatalog(target).catalog).toEqual(catalog);
  expect(target.getItem("unrelated")).toBe("kept");
});

it("refuses stale updates and corrupt saves while preserving original data", () => {
  const target = storage();
  target.setItem(PROJECT_CATALOG_KEY, "corrupt");
  expect(loadProjectCatalog(target).error).toBeTruthy();
  expect(() => saveProjectCatalog(catalog, { storage: target, expectedRaw: null })).toThrow(/其他窗口|变化/);
  expect(target.getItem(PROJECT_CATALOG_KEY)).toBe("corrupt");
});

it("reports storage failure and readback mismatch", () => {
  expect(() => saveProjectCatalog(catalog, { expectedRaw: null, storage: {
    getItem: () => null, setItem: () => { throw new Error("空间不足"); },
  } })).toThrow("空间不足");
  expect(() => saveProjectCatalog(catalog, { expectedRaw: null, storage: {
    getItem: () => null, setItem: () => undefined,
  } })).toThrow(/回读/);
});
