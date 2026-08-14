import { describe, expect, it, vi } from "vitest";
import type { SessionActivity } from "../terminal/contracts";
import {
  applySnapshot,
  closeTabsForPath,
  createProjectSwitchTab,
  createWorkspaceTab,
  groupTabsByProject,
  nextActiveTab,
  nextOrdinal,
} from "./tabs";

const project = { id: "p1", name: "demo", rootPath: "/demo", rootUri: "file:///demo" };
const other = { id: "p2", name: "other", rootPath: "/other", rootUri: "file:///other" };

describe("workspace tabs", () => {
  it("maps fixed agent kinds to fixed launch profiles", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "tab-1" });
    expect(createWorkspaceTab(project, "codex", 1)).toMatchObject({
      id: "tab-1",
      project,
      profileId: "agent:codex",
      title: "Codex 01",
    });
    vi.unstubAllGlobals();
  });

  it("selects a surviving neighbor when the active tab closes", () => {
    const tabs = ["a", "b", "c"].map((id) => ({
      ...createWorkspaceTab(project, "shell", 1),
      id,
    }));
    expect(nextActiveTab(tabs, "b").activeId).toBe("c");
  });

  it("creates a shell for a project switch without changing the active tab", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "switched" });
    const active = { ...createWorkspaceTab(project, "codex", 1), id: "active" };
    const switched = createProjectSwitchTab([active], other);

    expect(switched).toMatchObject({
      id: "switched",
      project: other,
      kind: "shell",
      title: "Shell 01",
    });
    expect(active.project).toBe(project);
    vi.unstubAllGlobals();
  });

  it("continues the global shell sequence when switching projects", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "switched" });
    const shell = { ...createWorkspaceTab(project, "shell", 1), id: "shell" };
    expect(createProjectSwitchTab([shell], other)).toMatchObject({
      project: other,
      kind: "shell",
      title: "Shell 02",
    });
    vi.unstubAllGlobals();
  });
});

describe("closing every session in a directory", () => {
  const a1 = { ...createWorkspaceTab(project, "shell", 1), id: "a1" };
  const a2 = { ...createWorkspaceTab(project, "shell", 2), id: "a2" };
  const b1 = { ...createWorkspaceTab(other, "shell", 3), id: "b1" };

  it("moves the active session to the first survivor when it dies with its directory", () => {
    // 逐条 closeTab 会把活动切到同目录的 a2，a2 随后也被关掉，活动就悬空了；
    // 这里必须一次算好，落到其他目录的第一个会话。
    const result = closeTabsForPath([a1, a2, b1], "a1", "/demo");
    expect(result.remaining.map((tab) => tab.id)).toEqual(["b1"]);
    expect(result.activeId).toBe("b1");
  });

  it("leaves an active session in another directory alone", () => {
    const result = closeTabsForPath([a1, b1, a2], "b1", "/demo");
    expect(result.remaining.map((tab) => tab.id)).toEqual(["b1"]);
    expect(result.activeId).toBe("b1");
  });

  it("closes to no active session when the directory held every session", () => {
    const result = closeTabsForPath([a1, a2], "a2", "/demo");
    expect(result.remaining).toEqual([]);
    expect(result.activeId).toBeNull();
  });

  it("matches directories ignoring case and separator spelling", () => {
    const win = { ...a1, project: { ...project, rootPath: "C:\\Demo\\" } };
    const result = closeTabsForPath([win], "win", "c:/demo");
    expect(result.remaining).toEqual([]);
    expect(result.activeId).toBeNull();
  });
});

describe("snapshot merge", () => {
  const base = { ...createWorkspaceTab(project, "shell", 1), id: "t1" };
  const snapshot = (lastInput: string | null, activity: SessionActivity = "idle") => ({
    phase: "running" as const,
    error: null,
    lastInput,
    activity,
  });

  it("renames the session from the latest informative input", () => {
    const named = applySnapshot(base, snapshot("帮我修复登录超时"));
    expect(named.title).toBe("帮我修复登录超时");
    expect(named.titleHint).toBe("帮我修复登录超时");

    // 「始终跟随最新一条」：下一条够格的输入接着顶掉上一条。
    expect(applySnapshot(named, snapshot("再加个测试")).title).toBe("再加个测试");
  });

  it("keeps the previous name when the input carries no information", () => {
    const named = applySnapshot(base, snapshot("pnpm dev"));
    expect(applySnapshot(named, snapshot("ls")).title).toBe("pnpm dev");
    expect(applySnapshot(base, snapshot("ls")).title).toBe("Shell 01");
  });

  it("keeps the untruncated original as the tooltip hint", () => {
    const long = "帮我把这个项目里所有的接口都补上错误处理和重试逻辑";
    const named = applySnapshot(base, snapshot(long));
    expect(named.title.endsWith("…")).toBe(true);
    expect(named.titleHint).toBe(long);
  });

  it("returns the same object when nothing changed", () => {
    const named = applySnapshot(base, snapshot("pnpm dev"));
    // phase 每次输出都会上报一遍，这里不短路就会让整条侧栏跟着重渲染。
    expect(applySnapshot(named, snapshot("pnpm dev"))).toBe(named);
  });

  it("does not disturb the title when only phase changes", () => {
    const named = applySnapshot(base, snapshot("pnpm dev"));
    const exited = applySnapshot(named, {
      phase: "exited",
      error: null,
      lastInput: "pnpm dev",
      activity: "idle",
    });
    expect(exited.phase).toBe("exited");
    expect(exited.title).toBe("pnpm dev");
    expect(exited.titleHint).toBe("pnpm dev");
  });

  it("carries activity through without touching the title", () => {
    const named = applySnapshot(base, snapshot("pnpm dev"));
    const busy = applySnapshot(named, snapshot("pnpm dev", "talking"));
    expect(busy.activity).toBe("talking");
    expect(busy.title).toBe("pnpm dev");
    // 状态一秒可能翻好几次，没变就必须返回原对象，否则整条侧栏跟着重渲染。
    expect(applySnapshot(busy, snapshot("pnpm dev", "talking"))).toBe(busy);
  });
});

describe("project grouping", () => {
  it("groups sessions by project in first-seen order", () => {
    const tabs = [
      { ...createWorkspaceTab(project, "shell", 1), id: "a" },
      { ...createWorkspaceTab(other, "shell", 2), id: "b" },
      { ...createWorkspaceTab(project, "claude", 1), id: "c" },
    ];
    const groups = groupTabsByProject(tabs);
    expect(groups.map((group) => group.project.id)).toEqual(["p1", "p2"]);
    expect(groups[0].tabs.map((tab) => tab.id)).toEqual(["a", "c"]);
    expect(groups[1].tabs.map((tab) => tab.id)).toEqual(["b"]);
  });

  it("numbers sessions per kind across every project", () => {
    const tabs = [
      createWorkspaceTab(project, "shell", 1),
      createWorkspaceTab(other, "shell", 2),
    ];
    // 第三个 shell 落在别的项目里也接着排 03，避免组间出现重名会话
    expect(nextOrdinal(tabs, "shell")).toBe(3);
    expect(nextOrdinal(tabs, "claude")).toBe(1);
  });
});
