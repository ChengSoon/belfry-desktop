import { describe, expect, it } from "vitest";
import type { TaskView } from "./api";
import { activeTasks, awaitingApproval, taskTone } from "./taskTone";

function task(state: string, id = state): TaskView {
  return {
    id,
    shortId: id.slice(0, 8),
    fromLabel: "planner",
    toLabel: "reviewer",
    instruction: "审一下 auth.ts",
    state,
    hop: 1,
    createdAt: 0,
    result: null,
  };
}

describe("taskTone", () => {
  it("submitted describes only terminal submission, never completion", () => {
    const dispatched = taskTone("dispatched");
    expect(dispatched.label).toBe("已提交到终端");
    expect(dispatched.label).not.toContain("已完成");
    expect(dispatched.tone).toBe("running");
  });

  it("完成要标明是对方自己说的", () => {
    expect(taskTone("done").label).toContain("对方自己说的");
  });

  it("等确认的要能被拎出来", () => {
    expect(taskTone("pendingapproval").tone).toBe("waiting");
  });

  it("认不出的状态原样显示，不猜", () => {
    expect(taskTone("something-new").label).toBe("something-new");
  });
});

describe("分组", () => {
  const tasks = [
    task("pendingapproval"),
    task("queued"),
    task("dispatched"),
    task("done"),
    task("failed"),
    task("abandoned"),
  ];

  it("等确认的单独一组", () => {
    expect(awaitingApproval(tasks).map((t) => t.state)).toEqual(["pendingapproval"]);
  });

  it("在跑的只算排队和已送出", () => {
    expect(activeTasks(tasks).map((t) => t.state)).toEqual(["queued", "dispatched"]);
  });
});
