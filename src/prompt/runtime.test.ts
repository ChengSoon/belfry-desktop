import { describe, expect, it, vi } from "vitest";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { PromptQueueRuntime } from "./runtime";

const project = { id: "project", name: "Project", rootPath: "/project", rootUri: "/project" };

function tab(overrides: Partial<WorkspaceTab> = {}): WorkspaceTab {
  return {
    id: "agent-1",
    project,
    kind: "codex",
    title: "Codex 01",
    titleHint: null,
    customTitle: null,
    agentName: null,
    profileId: "agent:codex",
    collaborationMode: false,
    sshTarget: null,
    resumeSessionId: null,
    phase: "running",
    activity: "idle",
    error: null,
    ...overrides,
  };
}

function target(sendText = vi.fn(() => true)): TerminalCommandTarget {
  return { focus: vi.fn(), sendText };
}

function targets(entry?: TerminalCommandTarget) {
  return new Map(entry ? [["agent-1", entry]] : []);
}

describe("PromptQueueRuntime", () => {
  it("sends the first prompt immediately and queues later prompts until the Agent is idle again", () => {
    const runtime = new PromptQueueRuntime();
    const command = target();

    expect(runtime.submit([tab()], targets(command), "agent-1", "first")).toBe("sent");
    expect(runtime.submit([tab()], targets(command), "agent-1", "second")).toBe("queued");
    expect(command.sendText).toHaveBeenCalledTimes(1);
    expect(runtime.items.map((item) => item.text)).toEqual(["second"]);

    runtime.sync([tab({ activity: "talking" })], targets(command));
    runtime.sync([tab()], targets(command));
    runtime.sync([tab()], targets(command));

    expect(command.sendText).toHaveBeenCalledTimes(2);
    expect(command.sendText).toHaveBeenLastCalledWith("second", expect.objectContaining({ background: true }));
    expect(runtime.items).toEqual([]);
  });

  it("keeps prompts queued until a running terminal target is registered", () => {
    const runtime = new PromptQueueRuntime();
    const command = target();

    expect(runtime.submit([tab()], targets(), "agent-1", "wait for target")).toBe("queued");
    runtime.sync([tab()], targets());
    expect(runtime.items).toHaveLength(1);

    runtime.sync([tab()], targets(command));
    expect(command.sendText).toHaveBeenCalledWith("wait for target", expect.any(Object));
    expect(runtime.items).toEqual([]);
  });

  it("restores a definitely unwritten prompt when the terminal restarts", () => {
    const runtime = new PromptQueueRuntime();
    const firstTarget = target();
    const nextTarget = target();

    runtime.submit([tab()], targets(firstTarget), "agent-1", "survive restart");
    vi.mocked(firstTarget.sendText).mock.calls[0][1]?.onResult?.("not-written");
    runtime.sync([tab({ phase: "creating" })], targets(firstTarget));
    expect(runtime.items.map((item) => item.text)).toEqual(["survive restart"]);

    runtime.sync([tab()], targets(nextTarget));
    expect(nextTarget.sendText).toHaveBeenCalledTimes(1);
    expect(nextTarget.sendText).toHaveBeenCalledWith("survive restart", expect.any(Object));
  });

  it("restores a definitely unwritten prompt when xterm remounts without a phase transition", () => {
    const runtime = new PromptQueueRuntime();
    const firstTarget = target();
    const nextTarget = target();

    runtime.submit([tab()], targets(firstTarget), "agent-1", "target replaced");
    vi.mocked(firstTarget.sendText).mock.calls[0][1]?.onResult?.("not-written");
    runtime.sync([tab()], targets());
    expect(runtime.items.map((item) => item.text)).toEqual(["target replaced"]);

    runtime.sync([tab()], targets(nextTarget));
    expect(nextTarget.sendText).toHaveBeenCalledWith("target replaced", expect.any(Object));
  });

  it("does not duplicate a prompt when the Agent is already busy during a target remount", () => {
    const runtime = new PromptQueueRuntime();
    const firstTarget = target();
    const nextTarget = target();

    runtime.submit([tab()], targets(firstTarget), "agent-1", "already accepted");
    runtime.sync([tab({ activity: "talking" })], targets(nextTarget));
    runtime.sync([tab()], targets(nextTarget));

    expect(nextTarget.sendText).not.toHaveBeenCalled();
    expect(runtime.items).toEqual([]);
  });

  it("retains a queued prompt when sending fails and removes prompts after the tab closes", () => {
    const runtime = new PromptQueueRuntime();
    const failing = target(vi.fn(() => false));

    expect(runtime.submit([tab()], targets(failing), "agent-1", "retry later")).toBe("queued");
    runtime.sync([tab()], targets(failing));
    expect(runtime.items.map((item) => item.text)).toEqual(["retry later"]);

    runtime.sync([], targets());
    expect(runtime.items).toEqual([]);
  });

  it("rejects blank, closed, and non-Agent targets", () => {
    const runtime = new PromptQueueRuntime();
    const command = target();

    expect(runtime.submit([tab()], targets(command), "agent-1", "   ")).toBe("unavailable");
    expect(runtime.submit([tab({ phase: "exited" })], targets(command), "agent-1", "x"))
      .toBe("unavailable");
    expect(runtime.submit([tab({ kind: "shell", profileId: "system-default" })], targets(command), "agent-1", "x"))
      .toBe("unavailable");
  });

  it("waits for permission choices before dispatching queued collaboration messages", () => {
    const runtime = new PromptQueueRuntime();
    const command = target();
    const waiting = tab({ activity: "awaiting-choice" });

    expect(runtime.submit([waiting], targets(command), "agent-1", "待处理任务")).toBe("queued");
    runtime.sync([waiting], targets(command));
    expect(command.sendText).not.toHaveBeenCalled();
    expect(runtime.items).toHaveLength(1);

    runtime.sync([tab()], targets(command));
    expect(command.sendText).toHaveBeenCalledExactlyOnceWith("待处理任务", expect.any(Object));
    expect(runtime.items).toEqual([]);
  });
});
