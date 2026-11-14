import type { DeliveryPhase, TaskView } from "./api";
import { t } from "../i18n";

export interface TaskTone {
  label: string;
  /** 需要用户动手的排前面，也决定用哪种视觉重量。 */
  tone: "waiting" | "running" | "done" | "failed" | "gone";
}

/**
 * 一条任务的状态文案。
 *
 * 最要紧的一条规矩：`dispatched` 只表示「指令已经打进对方终端」，**不表示对方做完了**。
 * 任务完成以对方提交的 `belfry done` 为准；会话状态报告里的 done 只表示本轮响应结束。
 * 因此派发后的任务完成情况仍然未知，等待任务协议里的结果。
 */
export function deliveryLabel(phase: DeliveryPhase): string { return t(`collab.delivery.${phase}`); }

export function taskTone(state: string, phase?: DeliveryPhase): TaskTone {
  if (!["pendingapproval", "done", "failed", "abandoned"].includes(state) && phase) {
    return { label: deliveryLabel(phase), tone: phase === "uncertain" ? "waiting" : phase === "cancelled" ? "gone" : "running" };
  }
  switch (state) {
    case "pendingapproval":
      return { label: t("collab.work.approval"), tone: "waiting" };
    case "accepted":
    case "queued":
    case "submitting":
    case "submitted":
      return { label: deliveryLabel(state), tone: "running" };
    case "uncertain":
      return { label: deliveryLabel(state), tone: "waiting" };
    case "cancelled":
      return { label: deliveryLabel(state), tone: "gone" };
    case "dispatched":
      return { label: deliveryLabel("submitted"), tone: "running" };
    case "done":
      return { label: t("collab.work.done"), tone: "done" };
    case "failed":
      return { label: t("collab.work.failed"), tone: "failed" };
    case "abandoned":
      return { label: t("collab.work.abandoned"), tone: "gone" };
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
  return tasks.filter((task) => ["accepted", "queued", "submitting", "uncertain", "dispatched"].includes(task.state));
}
