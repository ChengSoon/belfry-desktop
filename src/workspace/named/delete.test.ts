import { expect, it } from "vitest";
import { deleteNamedWorkspace, registerWorkspaceTab, switchNamedWorkspace } from "./actions";
import { fixtureCollection, memoryStorage, threePanes } from "./fixtures";
import { currentWorkspace, initialCollection } from "./model";
import { loadNamedWorkspaces, saveNamedWorkspaces } from "./storage";

it("删除当前工作区时迁移全部会话，切换目标并保留目标焦点与布局", () => {
  const before = switchNamedWorkspace(fixtureCollection(), "two");
  const result = deleteNamedWorkspace(before, { id: "two", destinationId: "one" });
  expect(result.workspaces.map((item) => item.id)).toEqual(["one", "empty"]);
  expect(result.activeWorkspaceId).toBe("one");
  expect(currentWorkspace(result).tabIds).toEqual(["a", "b", "c", "d", "e"]);
  expect(currentWorkspace(result).activeTabId).toBe("b");
  expect(currentWorkspace(result).layout).toBe(threePanes);
  expect(before.workspaces[1].tabIds).toEqual(["e"]);
});

it("迁入空目标时恢复可用焦点，删除后台空工作区不改变当前工作区", () => {
  const moved = deleteNamedWorkspace(fixtureCollection(), { id: "one", destinationId: "empty" });
  expect(currentWorkspace(moved).tabIds).toEqual(["a", "b", "c", "d"]);
  expect(currentWorkspace(moved).activeTabId).toBe("a");
  const before = fixtureCollection();
  const removed = deleteNamedWorkspace(before, { id: "empty", destinationId: "two" });
  expect(currentWorkspace(removed)).toBe(currentWorkspace(before));
});

it("拒绝删除最后一个工作区、无效来源或无效迁移目标", () => {
  const before = fixtureCollection();
  expect(() => deleteNamedWorkspace(initialCollection({ tabIds: [], activeTabId: null }),
    { id: "default", destinationId: "default" })).toThrow("至少保留一个工作区");
  expect(() => deleteNamedWorkspace(before, { id: "missing", destinationId: "one" })).toThrow("已不存在");
  for (const destinationId of ["missing", "one"]) {
    expect(() => deleteNamedWorkspace(before, { id: "one", destinationId })).toThrow("目标工作区");
  }
});

it("删除结果持久化后不复活工作区，所有会话归属保持唯一", () => {
  const result = deleteNamedWorkspace(fixtureCollection(), { id: "one", destinationId: "two" });
  const storage = memoryStorage();
  saveNamedWorkspaces(result, { storage, expectedRaw: null });
  const restored = loadNamedWorkspaces({ tabIds: ["a", "b", "c", "d", "e"], activeTabId: "e" }, storage);
  expect(restored.error).toBeNull();
  expect(restored.collection).toEqual(result);
  expect(restored.collection.workspaces.flatMap((item) => item.tabIds).sort()).toEqual(["a", "b", "c", "d", "e"]);
});

it("删除后迟到的会话加入当前工作区，不报错也不抢占焦点", () => {
  const removed = deleteNamedWorkspace(fixtureCollection(), { id: "one", destinationId: "two" });
  const result = registerWorkspaceTab(removed, { workspaceId: "one", tabId: "late", activate: true });
  expect(currentWorkspace(result).tabIds).toContain("late");
  expect(currentWorkspace(result).activeTabId).toBe("e");
});
