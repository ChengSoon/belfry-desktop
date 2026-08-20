import { describe, expect, it } from "vitest";
import {
  parseRecentProjects,
  parseWorkspaceState,
  rememberProject,
  removeRecentProject,
  serializeWorkspaceState,
} from "./storage";
import { createWorkspaceTab } from "./tabs";

describe("recent projects", () => {
  it("deduplicates and caps project history", () => {
    const project = { id: "p0", name: "zero", rootPath: "/zero", rootUri: "file:///zero" };
    const recent = Array.from({ length: 7 }, (_, index) => ({
      id: `p${index}`,
      name: `project-${index}`,
      rootPath: index === 0 ? "/zero" : `/project-${index}`,
    }));
    const result = rememberProject(project, recent);
    expect(result).toHaveLength(6);
    expect(result[0]).toEqual({ id: "p0", name: "zero", rootPath: "/zero" });
    expect(result.filter((item) => item.rootPath === "/zero")).toHaveLength(1);
  });

  it("drops malformed persisted entries", () => {
    expect(parseRecentProjects('[{"id":"ok","name":"demo","rootPath":"/demo"},{"id":2}]'))
      .toEqual([{ id: "ok", name: "demo", rootPath: "/demo" }]);
  });

  it("deduplicates persisted paths after project id migrations", () => {
    const persisted = JSON.stringify([
      { id: "new-id", name: "demo", rootPath: "/demo" },
      { id: "legacy-id", name: "demo", rootPath: "/demo" },
    ]);
    expect(parseRecentProjects(persisted)).toEqual([
      { id: "new-id", name: "demo", rootPath: "/demo" },
    ]);
  });

  it("removes an entry by id and leaves the rest untouched", () => {
    const recent = [
      { id: "p0", name: "zero", rootPath: "/zero" },
      { id: "p1", name: "one", rootPath: "/one" },
    ];
    expect(removeRecentProject(recent, "p0")).toEqual([
      { id: "p1", name: "one", rootPath: "/one" },
    ]);
  });

  it("returns the same list for an unknown id", () => {
    const recent = [{ id: "p0", name: "zero", rootPath: "/zero" }];
    expect(removeRecentProject(recent, "missing")).toEqual(recent);
  });

  it("tolerates an empty list", () => {
    expect(removeRecentProject([], "p0")).toEqual([]);
  });
});

describe("workspace session persistence", () => {
  const project = { id: "p1", name: "demo", rootPath: "/demo", rootUri: "file:///demo" };

  it("restores session order, titles, projects, kinds, and the active session", () => {
    const shell = { ...createWorkspaceTab(project, "shell", 1), id: "shell-1" };
    const codex = {
      ...createWorkspaceTab(project, "codex", 1),
      id: "codex-1",
      title: "修复登录",
      titleHint: "帮我修复登录",
      phase: "error" as const,
      activity: "awaiting-choice" as const,
      error: "old failure",
    };

    const restored = parseWorkspaceState(serializeWorkspaceState([shell, codex], codex.id));
    expect(restored?.tabs.map((tab) => tab.id)).toEqual(["shell-1", "codex-1"]);
    expect(restored?.activeTabId).toBe("codex-1");
    expect(restored?.tabs[1]).toMatchObject({
      project,
      kind: "codex",
      profileId: "agent:codex",
      title: "修复登录",
      titleHint: "帮我修复登录",
      phase: "idle",
      activity: "idle",
      error: null,
    });
  });

  it("persists and restores the resumed history session id", () => {
    const resumed = {
      ...createWorkspaceTab(project, "codex", 1),
      id: "codex-1",
      resumeSessionId: "019ff0d5-dbaf-7893-96db-4fbbbfee03a7",
    };
    const restored = parseWorkspaceState(serializeWorkspaceState([resumed], resumed.id));
    expect(restored?.tabs[0].resumeSessionId).toBe("019ff0d5-dbaf-7893-96db-4fbbbfee03a7");
    expect(restored?.tabs[0].agentSessionRef).toEqual({
      agent: "codex",
      id: "019ff0d5-dbaf-7893-96db-4fbbbfee03a7",
    });
    // 普通会话持久化为 null，而不是缺字段。
    const plain = parseWorkspaceState(serializeWorkspaceState([createWorkspaceTab(project, "shell", 1)], null));
    expect(plain?.tabs[0].resumeSessionId).toBeNull();
  });

  it("persists the selected shell profile and keeps old saves on the default", () => {
    const shell = {
      ...createWorkspaceTab(project, "shell", 1, null, null, "shell:bash"),
      id: "shell-bash",
    };
    const restored = parseWorkspaceState(serializeWorkspaceState([shell], shell.id));
    expect(restored?.tabs[0].profileId).toBe("shell:bash");

    const old = parseWorkspaceState(JSON.stringify({
      tabs: [{ id: "legacy", project, kind: "shell", title: "Shell 01", titleHint: null }],
      activeTabId: "legacy",
    }));
    expect(old?.tabs[0].profileId).toBe("system-default");
  });

  it("rejects an Agent session reference that crosses the tab kind", () => {
    const restored = parseWorkspaceState(JSON.stringify({
      tabs: [{
        id: "cross-agent",
        project,
        kind: "codex",
        title: "Codex 01",
        titleHint: null,
        resumeSessionId: "same-id",
        agentSessionRef: { agent: "claude", id: "same-id" },
      }],
      activeTabId: "cross-agent",
    }));
    expect(restored?.tabs).toEqual([]);
  });

  it("rejects a persisted shell profile outside the fixed allowlist", () => {
    const restored = parseWorkspaceState(JSON.stringify({
      tabs: [{
        id: "unsafe",
        project,
        kind: "shell",
        title: "Shell 01",
        titleHint: null,
        profileId: "/bin/sh",
      }],
      activeTabId: "unsafe",
    }));
    expect(restored?.tabs).toEqual([]);
  });

  it("rejects malformed or mismatched persisted resume references", () => {
    for (const resumeSessionId of [".", "../escape", "x".repeat(513)]) {
      const restored = parseWorkspaceState(JSON.stringify({
        tabs: [{
          id: "invalid-resume",
          project,
          kind: "codex",
          title: "Codex 01",
          titleHint: null,
          resumeSessionId,
        }],
        activeTabId: "invalid-resume",
      }));
      expect(restored?.tabs).toEqual([]);
    }
    const mismatched = parseWorkspaceState(JSON.stringify({
      tabs: [{
        id: "mismatched-resume",
        project,
        kind: "codex",
        title: "Codex 01",
        titleHint: null,
        resumeSessionId: "session-a",
        agentSessionRef: { agent: "codex", id: "session-b" },
      }],
      activeTabId: "mismatched-resume",
    }));
    expect(mismatched?.tabs).toEqual([]);
  });

  it("migrates an explicit session reference when the legacy id is absent", () => {
    const restored = parseWorkspaceState(JSON.stringify({
      tabs: [{
        id: "ref-only",
        project,
        kind: "claude",
        title: "Claude 01",
        titleHint: null,
        agentSessionRef: { agent: "claude", id: "session-ref" },
      }],
      activeTabId: "ref-only",
    }));
    expect(restored?.tabs[0]).toMatchObject({
      resumeSessionId: "session-ref",
      agentSessionRef: { agent: "claude", id: "session-ref" },
    });
  });

  it("persists and restores ssh connection targets", () => {
    const ssh = {
      ...createWorkspaceTab(
        project,
        "ssh",
        1,
        null,
        { host: "example.com", user: "root", port: 2222, password: null, rememberPassword: false },
      ),
      id: "ssh-1",
    };
    const restored = parseWorkspaceState(serializeWorkspaceState([ssh], ssh.id));
    expect(restored?.tabs[0]).toMatchObject({
      kind: "ssh",
      profileId: "ssh",
      title: "root@example.com",
      sshTarget: { host: "example.com", user: "root", port: 2222, password: null, rememberPassword: false },
    });
  });

  it("never persists ssh passwords into workspace state", () => {
    const ssh = {
      ...createWorkspaceTab(
        project,
        "ssh",
        1,
        null,
        {
          host: "example.com",
          user: null,
          port: null,
          password: "secret",
          rememberPassword: true,
        },
      ),
      id: "ssh-1",
    };
    const serialized = serializeWorkspaceState([ssh], ssh.id);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("rememberPassword");
    const restored = parseWorkspaceState(serialized);
    expect(restored?.tabs[0].sshTarget).toEqual({
      host: "example.com",
      user: null,
      port: null,
      password: null,
      rememberPassword: false,
    });
  });

  it("persists a custom ssh display name", () => {
    const ssh = {
      ...createWorkspaceTab(
        project,
        "ssh",
        1,
        null,
        { host: "example.com", user: null, port: null, password: null, rememberPassword: false },
      ),
      id: "ssh-1",
      title: "生产服务器",
      customTitle: "生产服务器",
    };
    const restored = parseWorkspaceState(serializeWorkspaceState([ssh], ssh.id));
    expect(restored?.tabs[0]).toMatchObject({
      title: "生产服务器",
      customTitle: "生产服务器",
    });
  });

  it("drops ssh sessions whose target is missing from an old save", () => {
    const persisted = JSON.stringify({
      tabs: [
        { id: "ssh-1", project, kind: "ssh", title: "broken", titleHint: null, sshTarget: null },
        { id: "shell-1", project, kind: "shell", title: "Shell 01", titleHint: null },
      ],
      activeTabId: "ssh-1",
    });
    const restored = parseWorkspaceState(persisted);
    expect(restored?.tabs.map((tab) => tab.id)).toEqual(["shell-1"]);
    expect(restored?.activeTabId).toBe("shell-1");
  });

  it("keeps an intentionally empty session list", () => {
    expect(parseWorkspaceState(serializeWorkspaceState([], null))).toEqual({
      tabs: [],
      activeTabId: null,
    });
  });

  it("drops malformed and duplicate sessions and repairs the active id", () => {
    const persisted = JSON.stringify({
      tabs: [
        { id: "one", project, kind: "shell", title: "Shell 01", titleHint: null },
        { id: "one", project, kind: "claude", title: "duplicate", titleHint: null },
        { id: "bad", project, kind: "unknown", title: "bad", titleHint: null },
      ],
      activeTabId: "missing",
    });
    const restored = parseWorkspaceState(persisted);
    expect(restored?.tabs).toHaveLength(1);
    expect(restored?.activeTabId).toBe("one");
  });
});
