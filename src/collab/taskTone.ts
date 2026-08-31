import type { TaskView } from "./api";

export interface TaskTone {
  label: string;
  /** 需要用户动手的排前面，也决定用哪种视觉重量。 */
  tone: "waiting" | "running" | "done" | "failed" | "gone";
}

/**
 * 一条任务的状态文案。
 *
 * 最要紧的一条规矩：`dispatched` 只表示「指令已经打进对方终端」，**不表示对方做完了**。
 * 完成信号只有对方自己敲 `belfry done` 才算数（`activity` 是扫屏幕猜的，拿猜测当完成
 * 依据就是把幻觉当锁）。所以这里如实写「完成情况未知」，不给用户一个虚假的进度条。
 */
export function taskTone(state: string): TaskTone {
  switch (state) {
    case "pendingapproval":
      return { label: "等你确认", tone: "waiting" };
    case "queued":
      // 目标正忙或卡在权限框，指令排在 Prompt 队列里等它空下来。
      return { label: "排队等对方空闲", tone: "running" };
    case "dispatched":
      return { label: "已送出 · 完成情况未知", tone: "running" };
    case "done":
      return { label: "已完成（对方自己说的）", tone: "done" };
    case "failed":
      return { label: "对方说做不了", tone: "failed" };
    case "abandoned":
      return { label: "目标会话没了", tone: "gone" };
    default:
      return { label: state, tone: "gone" };
  }
}

/** 等确认的任务：它们卡着整条链，面板要单独拎出来。 */
export function awaitingApproval(tasks: readonly TaskView[]) {
  return tasks.filter((task) => task.state === "pendingapproval");
}

/** 还在流程里的任务。已结的（done/failed/abandoned）不算。 */
export function activeTasks(tasks: readonly TaskView[]) {
  return tasks.filter((task) => task.state === "queued" || task.state === "dispatched");
}
