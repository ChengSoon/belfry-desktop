import { describe, expect, it } from "vitest";
import type { PromptQueueItem } from "../prompt/contracts";
import type { RecipeRun } from "./contracts";
import { deriveRecipeRun, recipeRunStatusLabel, type RecipeRunTarget } from "./run";

function run(overrides: Partial<RecipeRun> = {}): RecipeRun {
  return {
    id: "run-1",
    recipeId: "recipe-1",
    recipeName: "发布前检查",
    tabId: "agent-1",
    steps: [
      { stepId: "s1", text: "第一步" },
      { stepId: "s2", text: "第二步" },
      { stepId: "s3", text: "第三步" },
    ],
    startedAt: 1,
    aborted: false,
    skipped: [],
    ...overrides,
  };
}

function queued(...stepIds: string[]): PromptQueueItem[] {
  return stepIds.map((stepId, index) => ({
    id: `q-${stepId}`,
    tabId: "agent-1",
    text: stepId,
    createdAt: index,
    origin: { kind: "recipe" as const, runId: "run-1", stepId },
  }));
}

const running: RecipeRunTarget = { phase: "running", activity: "idle" };

describe("deriveRecipeRun", () => {
  it("treats queued steps as pending and absent ones as dispatched", () => {
    const view = deriveRecipeRun(run(), queued("s2", "s3"), running);
    expect(view.steps.map((step) => step.status)).toEqual(["dispatched", "pending", "pending"]);
    expect(view.dispatchedCount).toBe(1);
    expect(view.pendingCount).toBe(2);
    expect(view.currentStepId).toBe("s2");
    expect(view.status).toBe("running");
  });

  it("finishes once nothing is left in the queue", () => {
    const view = deriveRecipeRun(run(), [], running);
    expect(view.status).toBe("finished");
    expect(view.currentStepId).toBeNull();
    expect(recipeRunStatusLabel(view)).toBe("已全部送达");
  });

  // 终端重挂会把未确认的项放回队首，派生状态因此自动退回待发送——记账实现容易在这里漏。
  it("moves a step back to pending when the queue rolls it back", () => {
    const before = deriveRecipeRun(run(), queued("s2", "s3"), running);
    expect(before.steps[0].status).toBe("dispatched");

    const after = deriveRecipeRun(run(), queued("s1", "s2", "s3"), running);
    expect(after.steps[0].status).toBe("pending");
    expect(after.currentStepId).toBe("s1");
  });

  it("marks the run blocked while the Agent waits on a confirmation", () => {
    const view = deriveRecipeRun(run(), queued("s2", "s3"), {
      phase: "running",
      activity: "awaiting-choice",
    });
    expect(view.status).toBe("blocked");
    expect(view.blockedReason).toBe("awaiting-choice");
    expect(recipeRunStatusLabel(view)).toBe("等待确认");
  });

  it("blocks on a dead session but never re-flags an already finished run", () => {
    const dead: RecipeRunTarget = { phase: "exited", activity: "idle" };
    const stuck = deriveRecipeRun(run(), queued("s3"), dead);
    expect(stuck.status).toBe("blocked");
    expect(stuck.blockedReason).toBe("session-gone");

    const done = deriveRecipeRun(run(), [], dead);
    expect(done.status).toBe("finished");
    expect(done.blockedReason).toBeNull();
  });

  it("reports skipped steps and skips over them when picking the current step", () => {
    const view = deriveRecipeRun(run({ skipped: ["s2"] }), queued("s2", "s3"), running);
    expect(view.steps.map((step) => step.status)).toEqual(["dispatched", "skipped", "pending"]);
    expect(view.skippedCount).toBe(1);
    expect(view.currentStepId).toBe("s3");
  });

  it("keeps an aborted run aborted even though its queue is empty", () => {
    const view = deriveRecipeRun(run({ aborted: true }), [], running);
    expect(view.status).toBe("aborted");
    expect(recipeRunStatusLabel(view)).toBe("已中止");
  });

  /**
   * 会话关闭时 PromptQueueRuntime.sync 会清空队列项，"不在队列里"不再等于"已送达"。
   * 保守报未发送，别把被清理的步骤谎报成发出去了。
   */
  it("does not claim delivery for steps wiped by a closed session", () => {
    const view = deriveRecipeRun(run(), [], null);
    expect(view.status).toBe("aborted");
    expect(view.blockedReason).toBe("session-gone");
    expect(view.steps.every((step) => step.status === "pending")).toBe(true);
    expect(view.dispatchedCount).toBe(0);
    expect(recipeRunStatusLabel(view)).toBe("已中止");
  });

  it("ignores queue entries from other runs and manual prompts", () => {
    const foreign: PromptQueueItem[] = [
      { id: "m", tabId: "agent-1", text: "手工", createdAt: 0, origin: null },
      { id: "o", tabId: "agent-1", text: "别轮", createdAt: 1, origin: { kind: "recipe" as const, runId: "run-2", stepId: "s1" } },
    ];
    const view = deriveRecipeRun(run(), [...foreign, ...queued("s3")], running);
    expect(view.pendingCount).toBe(1);
    expect(view.currentStepId).toBe("s3");
  });
});
