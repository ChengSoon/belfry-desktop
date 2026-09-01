import { describe, expect, it } from "vitest";
import type { WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";
import { canReceiveWork, toSessionRoster } from "./contracts";

function tab(overrides: Partial<WorkspaceTab> & { kind: WorkspaceTabKind }): WorkspaceTab {
  return {
    id: "tab-1",
    project: {
      id: "p1",
      name: "demo",
      rootPath: "/tmp/demo",
      rootUri: "file:///tmp/demo",
    },
    title: "会话",
    titleHint: null,
    customTitle: null,
    agentName: null,
    profileId: overrides.kind === "claude" ? "agent:claude" : "agent:codex",
    collaborationMode: false,
    sshTarget: null,
    resumeSessionId: null,
    phase: "running",
    activity: "idle",
    error: null,
    ...overrides,
  };
}

describe("toSessionRoster", () => {
  it("只收 Agent 会话", () => {
    const roster = toSessionRoster([
      tab({ id: "a", kind: "claude" }),
      tab({ id: "b", kind: "codex" }),
      // Shell / SSH 拿不到身份牌，用不了 belfry 也接不了活。
      tab({ id: "c", kind: "shell", profileId: "system-default" }),
      tab({ id: "d", kind: "ssh", profileId: "ssh" }),
    ]);

    expect(roster.map((item) => item.tabId)).toEqual(["a", "b"]);
  });

  it("按 Rust 侧字段名给出会话状态", () => {
    const [entry] = toSessionRoster([
      tab({ id: "a", kind: "codex", title: "改路由", activity: "talking", agentName: "worker" }),
    ]);

    expect(entry).toEqual({
      tabId: "a",
      name: "worker",
      title: "改路由",
      agent: "codex",
      activity: "talking",
      canReceive: false,
      projectRoot: "/tmp/demo",
    });
  });

  it("没起名字的会话照样进名册，只是寻址不到", () => {
    // 得让 belfry peers 看得见它，才能提示用户「去给它起个名字」。
    const [entry] = toSessionRoster([tab({ id: "a", kind: "claude" })]);

    expect(entry.name).toBeNull();
    expect(entry.canReceive).toBe(true);
  });
});

describe("canReceiveWork", () => {
  it("空闲的 Agent 可以接活", () => {
    expect(canReceiveWork(tab({ kind: "claude" }))).toBe(true);
  });

  it("正在说话时不能接活", () => {
    expect(canReceiveWork(tab({ kind: "claude", activity: "talking" }))).toBe(false);
  });

  it("卡在权限框时不能接活", () => {
    // 这条最要紧：往权限框里 paste 文字可能替用户选中一个选项，
    // 而项目用 --dangerously-skip-permissions 起 Claude。
    expect(canReceiveWork(tab({ kind: "claude", activity: "awaiting-choice" }))).toBe(false);
  });

  it("进程已经退出时不能接活", () => {
    expect(canReceiveWork(tab({ kind: "codex", phase: "exited" }))).toBe(false);
    expect(canReceiveWork(tab({ kind: "codex", phase: "error" }))).toBe(false);
  });

  it("Shell 不是派活对象", () => {
    expect(canReceiveWork(tab({ kind: "shell", profileId: "system-default" }))).toBe(false);
  });
});
