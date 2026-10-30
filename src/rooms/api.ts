import { invoke } from "@tauri-apps/api/core";
import type { Room, RoomsView } from "./contracts";

/**
 * 房间命令封装。参数用 camelCase，Tauri 侧对齐 Rust 的 snake_case。
 *
 * 状态真相在 Rust：这里不做乐观更新，每个动作都会拿回对账后的整间房。
 */
export function roomList() {
  return invoke<RoomsView>("room_list");
}

export function roomGet(id: string) {
  return invoke<Room>("room_get", { id });
}

export function roomCreate(name: string, projectRoot: string) {
  return invoke<Room>("room_create", { name, projectRoot });
}

export function roomRename(id: string, name: string) {
  return invoke<Room>("room_rename", { id, name });
}

export function roomDelete(id: string) {
  return invoke<void>("room_delete", { id });
}

/** 在独立窗口打开一间房；已经开着时只聚焦。 */
export function roomOpenWindow(roomId: string, roomName: string) {
  return invoke<void>("room_open_window", { roomId, roomName });
}

/** 不选接收者直接发送的落点：@ 谁只发给谁（收窄），不 @ 发给全体；忙的成员排队而不是被整条拒掉。 */
export function roomBroadcast(id: string, text: string, replyTo?: string | null) {
  return invoke<Room>("room_broadcast", { id, text, replyTo: replyTo ?? null });
}

/** `projectRoot` 是成员会话所在项目；带上它，房间的接活范围会顺势扩展过去。 */
export function roomAddMember(id: string, tabId: string, agent: string, role: string, duty: string, projectRoot?: string) {
  return invoke<Room>("room_add_member", { id, tabId, agent, role, duty, projectRoot });
}

export function roomUpdateMember(
  id: string,
  memberId: string,
  patch: { role?: string; duty?: string; tabId?: string },
) {
  return invoke<Room>("room_update_member", { id, memberId, ...patch });
}

export function roomRemoveMember(id: string, memberId: string) {
  return invoke<Room>("room_remove_member", { id, memberId });
}


export function roomSendMessage(id: string, text: string, replyTo?: string | null) {
  return invoke<Room>("room_send_message", { id, text, replyTo: replyTo ?? null });
}

/** 给某条消息点表情（再点一次取消）。 */
export function roomReact(id: string, messageId: string, emoji: string) {
  return invoke<Room>("room_react", { id, messageId, emoji });
}

/** 撤回自己刚发的一条消息；还没送出的投递会当场撤掉。 */
export function roomRecall(id: string, messageId: string) {
  return invoke<Room>("room_recall", { id, messageId });
}

/** 清空房间的聊天记录；任务、决定与投递记录保留。 */
export function roomClearMessages(id: string) {
  return invoke<Room>("room_clear_messages", { id });
}

export function roomMarkDecision(id: string, messageId: string) {
  return invoke<Room>("room_mark_decision", { id, messageId });
}

/** 派活：选中接收者后发送，Rust 侧为每位成员扇出一条总线任务。 */
export function roomDispatch(id: string, text: string, memberIds: string[], acceptance?: string[]) {
  return invoke<Room>("room_dispatch", { id, text, memberIds, acceptance });
}

export function roomStopTask(id: string, taskId: string) {
  return invoke<Room>("room_stop_task", { id, taskId });
}

export function roomVerifyTask(id: string, taskId: string, note?: string) {
  return invoke<Room>("room_verify_task", { id, taskId, note });
}

/** 验证不通过：旧任务记为已退回，同时开一条带反馈的跟进派活。 */
export function roomRejectTask(id: string, taskId: string, feedback: string) {
  return invoke<Room>("room_reject_task", { id, taskId, feedback });
}

/** 待验证提醒的轮询行：房间与任务的身份、文案。 */
export interface PendingReview {
  roomId: string;
  roomName: string;
  taskId: string;
  title: string;
}

export function roomPendingReviews() {
  return invoke<PendingReview[]>("room_pending_reviews");
}

/** 整条重派（不给成员列表）或只补投指定成员。 */
export function roomRetryTask(id: string, taskId: string, memberIds?: string[]) {
  return invoke<Room>("room_retry_task", { id, taskId, memberIds });
}
