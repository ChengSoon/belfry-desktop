import { expect, it } from "vitest";
import { computeFrames, layoutTabIds } from "../../layout/tree";
import { activateWorkspaceTab, changeWorkspaceLayout, createNamedWorkspace, moveWorkspaceTab, registerWorkspaceTab, renameNamedWorkspace, switchNamedWorkspace } from "./actions";
import { currentWorkspace, reconcileCollection } from "./model";
import { fixtureCollection, threePanes } from "./fixtures";

it("切换只改变当前工作区，空工作区不复制或启动会话", () => {
  const before = fixtureCollection();
  const empty = switchNamedWorkspace(before, "empty");
  expect(currentWorkspace(empty).tabIds).toEqual([]);
  expect(currentWorkspace(empty).activeTabId).toBeNull();
  expect(empty.workspaces).toBe(before.workspaces);
  const back = switchNamedWorkspace(empty, "one");
  expect(currentWorkspace(back).layout).toBe(threePanes);
  expect(currentWorkspace(back).activeTabId).toBe("b");
  expect(computeFrames(currentWorkspace(back).layout!).panes[2].rect).toEqual({ left: 30, top: 65, width: 70, height: 35 });
});

it("Quick Open 跨工作区定位后保留其他工作区的布局，组内激活替换焦点窗格", () => {
  const before = fixtureCollection();
  const external = activateWorkspaceTab(before, "e");
  expect(external.activeWorkspaceId).toBe("two");
  expect(external.workspaces[0]).toBe(before.workspaces[0]);
  const result = activateWorkspaceTab(external, "d");
  expect(result.activeWorkspaceId).toBe("one");
  expect(currentWorkspace(result).activeTabId).toBe("d");
  expect(layoutTabIds(currentWorkspace(result).layout!)).toEqual(["a", "d", "c"]);
  expect(result.workspaces[1]).toBe(external.workspaces[1]);
});

it("关闭活动分屏时焦点交给当前空间的存活窗格，不跳到其他空间", () => {
  const result = reconcileCollection(fixtureCollection(), ["a", "c", "d", "e"]).collection;
  expect(result.activeWorkspaceId).toBe("one");
  expect(currentWorkspace(result).activeTabId).toBe("a");
  expect(layoutTabIds(currentWorkspace(result).layout!)).toEqual(["a", "c"]);
  const last = reconcileCollection(result, ["c", "d", "e"]).collection;
  expect(currentWorkspace(last).layout).toBeNull();
  expect(currentWorkspace(last).activeTabId).toBe("c");
});

it("新会话只加入当前工作区，后台快照不产生存档变化", () => {
  const before = fixtureCollection();
  expect(reconcileCollection(before, ["a", "b", "c", "d", "e"]).collection).toBe(before);
  const other = switchNamedWorkspace(before, "two");
  const added = reconcileCollection(other, ["a", "b", "c", "d", "e", "new"]).collection;
  expect(added.workspaces[0]).toBe(before.workspaces[0]);
  expect(currentWorkspace(added).tabIds).toEqual(["e", "new"]);
});

it("一次批处理里先请求新会话焦点再同步列表，焦点和布局仍指向新会话", () => {
  const focused = registerWorkspaceTab(fixtureCollection(), { workspaceId: "one", tabId: "new", activate: true });
  const result = reconcileCollection(focused, ["a", "b", "c", "d", "e", "new"]).collection;
  expect(currentWorkspace(result).activeTabId).toBe("new");
  expect(layoutTabIds(currentWorkspace(result).layout!)).toEqual(["a", "new", "c"]);
});

it("异步启动完成前已切换空间时，会话仍归属发起处且不抢新空间焦点", () => {
  const switched = switchNamedWorkspace(fixtureCollection(), "two");
  const result = registerWorkspaceTab(switched, { workspaceId: "one", tabId: "new", activate: true });
  expect(result.activeWorkspaceId).toBe("two");
  expect(currentWorkspace(result).activeTabId).toBe("e");
  expect(result.workspaces[0].tabIds).toContain("new");
  expect(result.workspaces[0].layout).toBe(threePanes);
  expect(activateWorkspaceTab(result, "already-closed")).toBe(result);
});

it("迁移只改变归属，原空间修复焦点并跟随到目标空间，不复制 tab ID", () => {
  const before = fixtureCollection();
  const result = moveWorkspaceTab(before, { tabId: "b", workspaceId: "two" });
  expect(currentWorkspace(result).activeTabId).toBe("b");
  expect(currentWorkspace(result).tabIds).toEqual(["e", "b"]);
  expect(result.workspaces[0].tabIds).toEqual(["a", "c", "d"]);
  expect(result.workspaces[0].activeTabId).toBe("a");
  expect(layoutTabIds(result.workspaces[0].layout!)).toEqual(["a", "c"]);
  expect(result.workspaces.flatMap((item) => item.tabIds).sort()).toEqual(["a", "b", "c", "d", "e"]);
  expect(before.workspaces[0].tabIds).toEqual(["a", "b", "c", "d"]);
});

it("名称去除边缘空白，禁止重复、控制字符和过长名称", () => {
  const before = fixtureCollection();
  const created = createNamedWorkspace(before, { id: "new", name: "  独立任务  " });
  expect(currentWorkspace(created)).toEqual({ id: "new", name: "独立任务", tabIds: [], activeTabId: null, layout: null });
  expect(() => createNamedWorkspace(before, { id: "new", name: "开发" })).toThrow("已有");
  expect(() => renameNamedWorkspace(before, { id: "one", name: "\n" })).toThrow();
  expect(() => renameNamedWorkspace(before, { id: "one", name: "a\u0000b" })).toThrow();
  expect(() => renameNamedWorkspace(before, { id: "one", name: "长".repeat(65) })).toThrow("64");
  expect(renameNamedWorkspace(before, { id: "one", name: " 开发 " })).toBe(before);
});

it("切换后的迟到布局回调不能污染新工作区", () => {
  const before = switchNamedWorkspace(fixtureCollection(), "two");
  const result = changeWorkspaceLayout(before, { workspaceId: "one", layout: null, focus: "a" });
  expect(result).toBe(before);
  expect(() => changeWorkspaceLayout(before, { workspaceId: "two", layout: threePanes })).toThrow("工作区");
});
