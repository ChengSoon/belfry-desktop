import { invoke } from "@tauri-apps/api/core";
import type { SessionSnapshot } from "./contracts";

/** 把会话名册推给 Rust，供控制 CLI 的 `peers` / 派活寻址查询。 */
export function syncSessions(sessions: SessionSnapshot[]) {
  return invoke<void>("collab_sync_sessions", { sessions });
}

/**
 * 等着投递的任务。`text` 是 Rust 拼好的三行注入文本。
 *
 * 前端拉而不是 Rust 推：只有前端知道目标终端的 xterm 挂上了没——targets 表在它手上。
 */
export interface PendingTask {
  id: string;
  text: string;
  /** 目标会话的 tabId（Rust 已经把名字解析成它了）。 */
  to: string;
  from: string;
  fromLabel: string;
  instruction: string;
}

export function pendingTasks() {
  return invoke<PendingTask[]>("collab_pending_tasks");
}

/** 回执：这条已经交给投递队列了，别再发给我。 */
export function markDispatched(id: string) {
  return invoke<void>("collab_mark_dispatched", { id });
}

/**
 * 一条任务在面板里的样子。两端都换成用户起的名字，`state` 是 Rust 侧
 * `TaskState` 的小写名（pendingapproval / queued / dispatched / done / failed / abandoned）。
 */
export interface TaskView {
  id: string;
  shortId: string;
  fromLabel: string;
  toLabel: string;
  instruction: string;
  state: string;
  hop: number;
  createdAt: number;
  result: string | null;
}

export function collabTasks() {
  return invoke<{ tasks: TaskView[] }>("collab_tasks");
}

/** 放行一条等确认的派活。批准之后它才会进投递队列。 */
export function approveTask(id: string) {
  return invoke<void>("collab_approve", { id });
}

export function rejectTask(id: string) {
  return invoke<void>("collab_reject", { id });
}

/** 一键全停，返回停掉几条。 */
export function stopAllTasks() {
  return invoke<number>("collab_stop_all");
}
