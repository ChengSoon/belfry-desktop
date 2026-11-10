import { t } from "../i18n";
import type { InboxStatus, MessageView, QuestionView, SessionView } from "./contracts";

export type StatusTone = "waiting" | "reply" | "attention" | "done" | "quiet";

const STATUS_CODES = new Set([
  "turn_busy", "previous_task", "task_dependency", "room_paused", "topic_held", "target_offline", "target_changed",
  "awaiting_input", "composer_not_empty", "source_sync_pending", "runtime_not_ready", "approval_required", "queue_turn",
  "collecting", "capacity_exceeded", "mixed_waiting", "prepared", "submitting", "submitted", "waiting_reply", "uncertain",
  "reference", "processing", "processed", "abandoned", "withdrawn", "fyi", "unknown_handling", "ready", "empty",
]);
const WITH_TASK = new Set(["previous_task", "task_dependency"]);

/** 状态码 → 整句文案。未知码不显示原始 code，给通用兜底。 */
export function statusText(status: InboxStatus | null | undefined): string {
  if (!status) return "";
  const code = STATUS_CODES.has(status.code) ? status.code : "unknown";
  if (WITH_TASK.has(code)) return t(`inbox.status.${code}`, { task: status.params.task ?? "" });
  return t(`inbox.status.${code}`);
}

/** 琥珀=还在等，蓝=等对方回复，红=要人核对，绿=完成，灰=无需关注。 */
export function statusTone(status: InboxStatus | null | undefined): StatusTone {
  switch (status?.code) {
    case "uncertain": case "target_changed": return "attention";
    case "waiting_reply": return "reply";
    case "processed": case "prepared": case "submitting": return "done";
    case "submitted": case "unknown_handling": case "processing": case "fyi": case "withdrawn":
    case "abandoned": case "empty": case "reference": case undefined: return "quiet";
    default: return "waiting";
  }
}

/**
 * 一条消息下方显示的那一行状态：未送达优先给等待原因；送达后有待答问题显示“已投递待回复”，
 * 否则显示处理事实（不会因“没有剩余待发”就说成已处理）。
 */
export function messageStatus(message: MessageView): InboxStatus {
  if (message.deliveryPhase === "pending" && message.waitingReason) return message.waitingReason;
  if (message.deliveryPhase === "submitted") {
    if (message.class === "fyi") return { code: "fyi", params: {} };
    if (message.questions.some((q) => q.state === "open")) return { code: "waiting_reply", params: {} };
    if (message.handlingStatus.code === "processing" || message.handlingStatus.code === "processed") return message.handlingStatus;
  }
  return message.deliveryStatus;
}

export function questionState(question: QuestionView, message: MessageView): "replied" | "cancelled" | "awaiting" | "notDelivered" {
  if (question.state === "replied") return "replied";
  if (question.state === "cancelled") return "cancelled";
  return message.deliveryPhase === "submitted" ? "awaiting" : "notDelivered";
}

export function needsAttention(session: SessionView) {
  return session.pendingCount > 0 || session.awaitingReplyCount > 0 || session.summaryStatus.code === "uncertain";
}

/** 多个项目逐个查询后按 sessionKey 合并；同 key 取较新的那份。 */
export function mergeSessions(groups: readonly SessionView[][]): SessionView[] {
  const byKey = new Map<string, SessionView>();
  for (const group of groups) for (const session of group) {
    const known = byKey.get(session.sessionKey);
    if (!known || (session.lastMessageAt ?? 0) >= (known.lastMessageAt ?? 0)) byKey.set(session.sessionKey, session);
  }
  return [...byKey.values()].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || a.name.localeCompare(b.name));
}
