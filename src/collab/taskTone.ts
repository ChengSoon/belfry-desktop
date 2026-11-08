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
 * 完成信号只有对方自己敲 `belfry done` 才算数（`activity` 是扫屏幕猜的，拿猜测当完成
 * 依据就是把幻觉当锁）。所以这里如实写「完成情况未知」，不给用户一个虚假的进度条。
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
