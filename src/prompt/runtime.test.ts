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
    expect(command.sendText).toHaveBeenLastCalledWith("second");
    expect(runtime.items).toEqual([]);
  });

  it("keeps prompts queued until a running terminal target is registered", () => {
    const runtime = new PromptQueueRuntime();
    const command = target();

    expect(runtime.submit([tab()], targets(), "agent-1", "wait for target")).toBe("queued");
    runtime.sync([tab()], targets());
    expect(runtime.items).toHaveLength(1);

    runtime.sync([tab()], targets(command));
    expect(command.sendText).toHaveBeenCalledWith("wait for target");
    expect(runtime.items).toEqual([]);
  });

  it("restores an unconfirmed in-flight prompt when the terminal restarts", () => {
    const runtime = new PromptQueueRuntime();
    const firstTarget = target();
    const nextTarget = target();

    runtime.submit([tab()], targets(firstTarget), "agent-1", "survive restart");
    runtime.sync([tab({ phase: "creating" })], targets(firstTarget));
    expect(runtime.items.map((item) => item.text)).toEqual(["survive restart"]);

    runtime.sync([tab()], targets(nextTarget));
    expect(nextTarget.sendText).toHaveBeenCalledTimes(1);
    expect(nextTarget.sendText).toHaveBeenCalledWith("survive restart");
  });

  it("restores an in-flight prompt when xterm remounts without a phase transition", () => {
    const runtime = new PromptQueueRuntime();
    const firstTarget = target();
    const nextTarget = target();

    runtime.submit([tab()], targets(firstTarget), "agent-1", "target replaced");
    runtime.sync([tab()], targets());
    expect(runtime.items.map((item) => item.text)).toEqual(["target replaced"]);

    runtime.sync([tab()], targets(nextTarget));
    expect(nextTarget.sendText).toHaveBeenCalledWith("target replaced");
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

  describe("recipe runs", () => {
    const steps = [
      { stepId: "s1", text: "第一步" },
      { stepId: "s2", text: "第二步" },
      { stepId: "s3", text: "第三步" },
    ];

    it("dispatches the first step immediately and keeps the rest queued in order", () => {
      const runtime = new PromptQueueRuntime();
      const command = target();

      expect(runtime.enqueueRun([tab()], targets(command), "agent-1", steps, "run-1")).toBe(3);
      expect(command.sendText).toHaveBeenCalledTimes(1);
      expect(command.sendText).toHaveBeenCalledWith("第一步");
      expect(runtime.items.map((item) => item.text)).toEqual(["第二步", "第三步"]);
      expect(runtime.items.every((item) => item.origin?.runId === "run-1")).toBe(true);

      runtime.sync([tab({ activity: "talking" })], targets(command));
      runtime.sync([tab()], targets(command));
      expect(command.sendText).toHaveBeenLastCalledWith("第二步");
    });

    // 卡点暂停不靠 Recipe 自己实现：canDispatchPrompt 要求 idle，权限框一弹队列就停。
    it("stops dispatching while the Agent waits on a permission prompt, then resumes", () => {
      const runtime = new PromptQueueRuntime();
      const command = target();

      runtime.enqueueRun([tab({ activity: "awaiting-choice" })], targets(command), "agent-1", steps, "run-1");
      expect(command.sendText).not.toHaveBeenCalled();
      expect(runtime.items).toHaveLength(3);

      runtime.sync([tab({ activity: "awaiting-choice" })], targets(command));
      expect(command.sendText).not.toHaveBeenCalled();

      runtime.sync([tab()], targets(command));
      expect(command.sendText).toHaveBeenCalledWith("第一步");
    });

    it("drops only the aborted run and leaves other work alone", () => {
      const runtime = new PromptQueueRuntime();
      const command = target();

      runtime.enqueueRun([tab()], targets(command), "agent-1", steps, "run-1");
      runtime.submit([tab()], targets(command), "agent-1", "手工提交");
      runtime.enqueueRun([tab()], targets(command), "agent-1", [{ stepId: "x", text: "别的轮次" }], "run-2");

      runtime.removeRun("run-1");
      expect(runtime.items.map((item) => item.text)).toEqual(["手工提交", "别的轮次"]);
    });

    // 中止后一次终端重挂就会把 in-flight 当「未确认」回滚，用户明明中止过的步骤会再发一次。
    it("does not resurrect an aborted step when the terminal remounts", () => {
      const runtime = new PromptQueueRuntime();
      const firstTarget = target();
      const nextTarget = target();

      runtime.enqueueRun([tab()], targets(firstTarget), "agent-1", steps, "run-1");
      expect(firstTarget.sendText).toHaveBeenCalledWith("第一步");

      runtime.removeRun("run-1");
      expect(runtime.items).toEqual([]);

      runtime.sync([tab()], targets(nextTarget));
      expect(nextTarget.sendText).not.toHaveBeenCalled();
      expect(runtime.items).toEqual([]);
    });

    it("puts a resent step at the head of the queue", () => {
      const runtime = new PromptQueueRuntime();
      const command = target();

      runtime.enqueueRun([tab()], targets(command), "agent-1", steps, "run-1");
      runtime.enqueueRun([tab()], targets(command), "agent-1", [steps[0]], "run-1", "head");
      expect(runtime.items.map((item) => item.text)).toEqual(["第一步", "第二步", "第三步"]);
    });

    it("skips blank steps and refuses closed sessions", () => {
      const runtime = new PromptQueueRuntime();
      const command = target();

      expect(runtime.enqueueRun([tab()], targets(command), "agent-1", [{ stepId: "s1", text: "  " }], "run-1"))
        .toBe(0);
      expect(runtime.enqueueRun([tab({ phase: "exited" })], targets(command), "agent-1", steps, "run-1"))
        .toBe(0);
      expect(runtime.items).toEqual([]);
    });
  });
});
