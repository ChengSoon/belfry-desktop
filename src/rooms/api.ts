import { invoke } from "@tauri-apps/api/core";
import type { Room, RoomTaskOp, RoomsView } from "./contracts";

/**
 * 房间命令封装。参数用 camelCase，Tauri 侧对齐 Rust 的 snake_case。
 *
 * 状态真相在 Rust：这里不做乐观更新，每个动作都拿回改完的整间房。
 */
export function roomList() {
  return invoke<RoomsView>("room_list");
}

export function roomGet(id: string) {
  return invoke<Room>("room_get", { id });
}

export function roomCreate(name: string, projectRoot: string, objective: string) {
  return invoke<Room>("room_create", { name, projectRoot, objective });
}

export function roomRename(id: string, name: string) {
  return invoke<Room>("room_rename", { id, name });
}

export function roomDelete(id: string) {
  return invoke<void>("room_delete", { id });
}

export function roomAddMember(id: string, tabId: string, agent: string, title: string, duty: string, foreman: boolean) {
  return invoke<Room>("room_add_member", { id, tabId, agent, title, duty, foreman });
}

export function roomUpdateMember(id: string, memberId: string, patch: { title?: string; duty?: string; tabId?: string }) {
  return invoke<Room>("room_update_member", { id, memberId, ...patch });
}

export function roomSetForeman(id: string, memberId: string) {
  return invoke<Room>("room_set_foreman", { id, memberId });
}

export function roomRemoveMember(id: string, memberId: string) {
  return invoke<Room>("room_remove_member", { id, memberId });
}

export function roomUpdateBrief(id: string, patch: { objective?: string; focus?: string; constraints?: string[] }) {
  return invoke<Room>("room_update_brief", { id, ...patch });
}

/** `to` 为空时按正文 @点名，再按默认收件人（统筹）。`ask` 要求回复。有附件时正文可以为空。 */
export function roomSay(id: string, text: string, to: string[], replyTo: string | null, ask: boolean, attachmentIds: string[] = []) {
  return invoke<Room>("room_say", { id, text, to, replyTo, ask, attachmentIds });
}

export function roomCancelReply(id: string, messageId: string) {
  return invoke<Room>("room_cancel_reply", { id, messageId });
}

export function roomTask(id: string, op: RoomTaskOp) {
  return invoke<Room>("room_task", { id, op });
}
