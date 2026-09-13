import { expect, it } from "vitest";
import type { LayoutNode } from "../../layout/contracts";
import { MAX_LAYOUT_DEPTH, MAX_WORKSPACES } from "./contracts";
import { fixtureCollection, memoryStorage } from "./fixtures";
import { loadNamedWorkspaces } from "./storage";
import { saveWorkspaceState } from "../storage";

it("过深布局在递归展开前被拒绝，避免损坏存档使界面栈溢出", () => {
  const collection = fixtureCollection(), ids = ["root"];
  let tree: LayoutNode = { kind: "leaf", tabId: ids[0] };
  for (let index = 0; index < MAX_LAYOUT_DEPTH + 2; index++) {
    const id = `deep-${index}`; ids.push(id);
    tree = { kind: "split", direction: "row", ratio: 0.5, first: tree, second: { kind: "leaf", tabId: id } };
  }
  collection.workspaces[0] = { ...collection.workspaces[0], tabIds: ids, layout: tree };
  const result = loadNamedWorkspaces({ tabIds: ids, activeTabId: ids[0] }, memoryStorage(JSON.stringify(collection)));
  expect(result.error).toContain("过深");
});

it("布局重复叶子、跨工作区引用和过多工作区都被拒绝", () => {
  const duplicate = fixtureCollection();
  duplicate.workspaces[0].layout = { kind: "split", direction: "row", ratio: 0.5,
    first: { kind: "leaf", tabId: "a" }, second: { kind: "leaf", tabId: "a" } };
  const foreign = fixtureCollection(); foreign.workspaces[0].layout = { kind: "leaf", tabId: "e" };
  const excessive = fixtureCollection();
  excessive.workspaces = Array.from({ length: MAX_WORKSPACES + 1 }, (_, index) => ({
    id: `workspace-${index}`, name: `工作区 ${index}`, tabIds: [], activeTabId: null, layout: null,
  }));
  for (const collection of [duplicate, foreign, excessive]) {
    expect(loadNamedWorkspaces({ tabIds: [], activeTabId: null }, memoryStorage(JSON.stringify(collection))).error).not.toBeNull();
  }
});

it("原会话存档写入失败向界面返回原因，不能把布局保存等同于会话可恢复", () => {
  expect(saveWorkspaceState([], null, { setItem: () => { throw new Error("disk full"); } })).toBe("disk full");
  expect(saveWorkspaceState([], null, { setItem: () => {} })).toBeNull();
});

it("无效的当前工作区不会被静默替换，丢失焦点也给出恢复提示", () => {
  const invalid = fixtureCollection(); invalid.activeWorkspaceId = "missing";
  const seed = { tabIds: ["a", "b", "c", "d", "e"], activeTabId: "b" };
  expect(loadNamedWorkspaces(seed, memoryStorage(JSON.stringify(invalid))).error).toContain("引用无效");
  const focus = fixtureCollection(); focus.workspaces[0].activeTabId = "d";
  const restored = loadNamedWorkspaces(seed, memoryStorage(JSON.stringify(focus)));
  expect(restored.notices.join(" ")).toContain("活动会话不可用");
  expect(restored.collection.workspaces[0].activeTabId).toBe("a");
});
