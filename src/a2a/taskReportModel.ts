import { t } from "../i18n";
import type { ProtocolTaskPreview, TaskRef } from "./contracts";

export function taskReferenceKey(reference: TaskRef | null | undefined): string | null {
  if (!reference || !["direct_task", "room_task"].includes(reference.kind)
    || typeof reference.id !== "string" || !reference.id
    || !Number.isSafeInteger(reference.generation) || reference.generation < 0
    || (reference.kind === "room_task" ? typeof reference.roomId !== "string" || !reference.roomId : reference.roomId !== null)) return null;
  return JSON.stringify([reference.kind, reference.roomId, reference.id, reference.generation]);
}

/** Native orders current instances first. Keep its first exact reference match. */
export function taskReportIndex(tasks: readonly ProtocolTaskPreview[]): ReadonlyMap<string, ProtocolTaskPreview> {
  const index = new Map<string, ProtocolTaskPreview>();
  for (const task of tasks) {
    const key = taskReferenceKey(task.taskRef);
    if (key && task.source === "localA2A" && !index.has(key)) index.set(key, task);
  }
  return index;
}

export function taskReportFor(index: ReadonlyMap<string, ProtocolTaskPreview>, reference: TaskRef | null | undefined): ProtocolTaskPreview | undefined {
  const key = taskReferenceKey(reference);
  return key ? index.get(key) : undefined;
}

const states: Record<string, string> = {
  TASK_STATE_SUBMITTED: "submitted", TASK_STATE_WORKING: "working",
  TASK_STATE_INPUT_REQUIRED: "inputRequired", TASK_STATE_AUTH_REQUIRED: "authRequired",
  TASK_STATE_COMPLETED: "completed", TASK_STATE_FAILED: "failed",
  TASK_STATE_CANCELED: "canceled", TASK_STATE_REJECTED: "rejected",
};

export function protocolStateLabel(state: string): string {
  return t(`a2a.reports.states.${states[state] ?? "unknown"}`);
}

export function protocolStateTone(state: string): "active" | "waiting" | "done" | "failed" | "neutral" {
  if (state === "TASK_STATE_COMPLETED") return "done";
  if (["TASK_STATE_FAILED", "TASK_STATE_REJECTED"].includes(state)) return "failed";
  if (["TASK_STATE_INPUT_REQUIRED", "TASK_STATE_AUTH_REQUIRED"].includes(state)) return "waiting";
  if (state === "TASK_STATE_WORKING") return "active";
  return "neutral";
}
