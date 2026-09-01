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
  it("已送出不等于已完成", () => {
    // 完成信号只有对方敲 belfry done 才算数：activity 是扫屏幕猜的，
    // 拿猜测当完成依据就是把幻觉当锁。所以这里必须如实写「未知」。
    const dispatched = taskTone("dispatched");
    expect(dispatched.label).toContain("完成情况未知");
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
