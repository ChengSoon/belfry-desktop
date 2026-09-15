import { expect, it, vi } from "vitest";
import { loadNamedWorkspaces, saveNamedWorkspaces, replaceNamedArchive } from "./storage";
import { NAMED_RECOVERY_KEY, NAMED_WORKSPACES_KEY, MAX_COLLECTION_BYTES } from "./contracts";
import { fixtureCollection, memoryStorage } from "./fixtures";

const seed = { tabIds: ["a", "b", "c", "d", "e"], activeTabId: "b" };

it("旧存档首次迁移到默认工作区，不改原会话存档", () => {
  const disk = memoryStorage();
  disk.setItem("belfry.workspace.v1", "legacy");
  const result = loadNamedWorkspaces(seed, disk);
  expect(result.error).toBeNull();
  expect(result.collection.workspaces).toEqual([{ id: "default", name: "默认工作区", ...seed, layout: null }]);
  expect(disk.getItem("belfry.workspace.v1")).toBe("legacy");
});

it("重载三窗格方向、比例和焦点，空工作区可作为当前空间恢复", () => {
  const collection = fixtureCollection();
  const disk = memoryStorage();
  const raw = saveNamedWorkspaces(collection, { storage: disk, expectedRaw: null });
  expect(loadNamedWorkspaces(seed, disk).collection).toEqual(collection);
  const empty = { ...collection, activeWorkspaceId: "empty" };
  saveNamedWorkspaces(empty, { storage: disk, expectedRaw: raw });
  expect(loadNamedWorkspaces(seed, disk).collection).toEqual(empty);
});

it("缺失会话修复有可见说明，剩余布局不混入其他空间", () => {
  const disk = memoryStorage(JSON.stringify(fixtureCollection()));
  const result = loadNamedWorkspaces({ ...seed, tabIds: ["a", "c", "d", "e", "new"] }, disk);
  expect(result.error).toBeNull();
  expect(result.notices.join(" ")).toContain("1 条会话");
  expect(result.collection.workspaces[0].tabIds).toEqual(["a", "c", "d", "new"]);
  expect(result.collection.workspaces[1].tabIds).toEqual(["e"]);
});

it.each(["{", JSON.stringify({ ...fixtureCollection(), version: 2 }), " ".repeat(MAX_COLLECTION_BYTES + 1)])(
  "损坏或新版本存档保留原文，回退当前会话但禁止伪装为保存成功", (raw) => {
    const disk = memoryStorage(raw);
    const result = loadNamedWorkspaces(seed, disk);
    expect(result.error).not.toBeNull();
    expect(result.collection.workspaces[0].tabIds).toEqual(seed.tabIds);
    expect(result.raw).toBe(raw);
    expect(disk.getItem(NAMED_WORKSPACES_KEY)).toBe(raw);
  },
);

it("拒绝重复归属、重复名称以及无效布局比例", () => {
  const shared = fixtureCollection(); shared.workspaces[1].tabIds.push("a");
  const names = fixtureCollection(); names.workspaces[1].name = "开发";
  const ratio = fixtureCollection(); ratio.workspaces[0].layout = { kind: "split", direction: "row", ratio: 1,
    first: { kind: "leaf", tabId: "a" }, second: { kind: "leaf", tabId: "b" } };
  for (const value of [shared, names, ratio]) {
    expect(loadNamedWorkspaces(seed, memoryStorage(JSON.stringify(value))).error).not.toBeNull();
  }
});

it("保存检查其他窗口变化，存储失败原样上报", () => {
  const disk = memoryStorage("external");
  expect(() => saveNamedWorkspaces(fixtureCollection(), { storage: disk, expectedRaw: null })).toThrow("其他窗口");
  expect(disk.getItem(NAMED_WORKSPACES_KEY)).toBe("external");
  expect(() => saveNamedWorkspaces(fixtureCollection(), { expectedRaw: null,
    storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } } })).toThrow("quota");
});

it("明确替换异常存档时先保留恢复副本，备份失败不覆盖原档", () => {
  const disk = memoryStorage("broken");
  replaceNamedArchive(fixtureCollection(), { storage: disk, expectedRaw: "broken" });
  expect(disk.getItem(NAMED_RECOVERY_KEY)).toBe("broken");
  expect(loadNamedWorkspaces(seed, disk).error).toBeNull();
  const setItem = vi.fn((_key: string, _value: string) => { throw new Error("full"); });
  expect(() => replaceNamedArchive(fixtureCollection(), { expectedRaw: "broken",
    storage: { getItem: () => "broken", setItem } })).toThrow("full");
  expect(setItem).toHaveBeenCalledTimes(1);
  expect(setItem.mock.calls[0][0]).toBe(NAMED_RECOVERY_KEY);
});
