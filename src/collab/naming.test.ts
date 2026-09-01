import { describe, expect, it } from "vitest";
import type { WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";
import { AGENT_NAME_PATTERN, normalizeAgentName, resolveAgentRename } from "./naming";

function tab(overrides: Partial<WorkspaceTab> & { id: string }): WorkspaceTab {
  return {
    project: { id: "p1", name: "demo", rootPath: "/tmp/demo", rootUri: "file:///tmp/demo" },
    kind: "claude" as WorkspaceTabKind,
    title: "会话",
    titleHint: null,
    customTitle: null,
    agentName: null,
    profileId: "agent:claude",
    collaborationMode: false,
    sshTarget: null,
    resumeSessionId: null,
    phase: "running",
    activity: "idle",
    error: null,
    ...overrides,
  };
}

describe("normalizeAgentName", () => {
  it("顺手小写并去空白", () => {
    // UI 里打字带大写太常见，为此拒绝一次输入不值得；寻址那侧也是大小写不敏感的。
    expect(normalizeAgentName("  Reviewer  ")).toBe("reviewer");
  });

  it("空白输入等于清除名字", () => {
    expect(normalizeAgentName("   ")).toBeNull();
  });
});

describe("AGENT_NAME_PATTERN", () => {
  it("放行中文和其他文字的名字", () => {
    // 汉字不是 shell 元字符，`belfry send 审查 …` 裸写就能用，没有转义问题。
    for (const ok of ["审查", "前端", "跑测试", "架构师2", "レビュー", "리뷰"]) {
      expect(AGENT_NAME_PATTERN.test(ok), ok).toBe(true);
    }
  });

  it("放行常规的英文名字", () => {
    for (const ok of ["a", "reviewer", "web-2", "run_tests", "a".repeat(32)]) {
      expect(AGENT_NAME_PATTERN.test(ok), ok).toBe(true);
    }
  });

  it("挡住会被 shell 先解释一遍的写法", () => {
    // 这些真会出事：空格要引号，$ 和 | 会被 shell 吃掉，转义错了表现为「派活莫名失败」。
    for (const bad of ["code review", "审 查", "$(rm -rf /)", "a|b", 'a"b', "a'b", "a;b", "a`b"]) {
      expect(AGENT_NAME_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it("挡住会被当成命令行选项或和短 id 混淆的开头", () => {
    for (const bad of ["-lead", "1st", "_x", "2号"]) {
      expect(AGENT_NAME_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it("长度按字符算，中文不吃亏", () => {
    expect(AGENT_NAME_PATTERN.test("审".repeat(32))).toBe(true);
    expect(AGENT_NAME_PATTERN.test("审".repeat(33))).toBe(false);
    expect(AGENT_NAME_PATTERN.test("a".repeat(33))).toBe(false);
  });
});

describe("resolveAgentRename", () => {
  it("给出规整后的名字", () => {
    const result = resolveAgentRename("Reviewer", [tab({ id: "a" })], "a");
    expect(result).toEqual({ name: "reviewer" });
  });

  it("空输入是清除，不是错误", () => {
    expect(resolveAgentRename("", [tab({ id: "a" })], "a")).toEqual({ name: null });
  });

  it("挡住活会话之间的重名", () => {
    const tabs = [tab({ id: "a" }), tab({ id: "b", agentName: "reviewer" })];
    const result = resolveAgentRename("reviewer", tabs, "a");
    expect(result).toEqual({ error: expect.stringContaining("已经是另一条会话") });
  });

  it("已退出的会话不再占用名字", () => {
    // 否则开开关关几轮，短名字就都被幽灵会话占死了。
    const tabs = [tab({ id: "a" }), tab({ id: "b", agentName: "reviewer", phase: "exited" })];
    expect(resolveAgentRename("reviewer", tabs, "a")).toEqual({ name: "reviewer" });
  });

  it("改回自己原来的名字不算重名", () => {
    const tabs = [tab({ id: "a", agentName: "reviewer" })];
    expect(resolveAgentRename("reviewer", tabs, "a")).toEqual({ name: "reviewer" });
  });

  it("中文名字可以用", () => {
    expect(resolveAgentRename("审查", [tab({ id: "a" })], "a")).toEqual({ name: "审查" });
  });

  it("格式不对时给出规则本身", () => {
    const result = resolveAgentRename("代码 审查", [tab({ id: "a" })], "a");
    expect(result).toEqual({ error: expect.stringContaining("空格") });
  });
});
