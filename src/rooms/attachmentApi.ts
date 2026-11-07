import { invoke } from "@tauri-apps/api/core";
import type { RoomAttachment } from "./contracts";

export function pickRoomAttachments() {
  return invoke<string[]>("room_pick_attachments");
}

export function clipboardRoomFiles() {
  return invoke<string[]>("room_clipboard_files");
}

export async function importRoomAttachment(id: string, source: File | string) {
  if (typeof source === "string") return invoke<RoomAttachment>("room_import_attachment", { id, source });
  const extension = source.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const name = source.name || `粘贴附件.${extension}`;
  // HTTP 头只接受 ASCII；JSON Unicode 转义保留中文文件名和 emoji。
  const metadata = JSON.stringify({ roomId: id, name }).replace(/[^\x20-\x7e]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return invoke<RoomAttachment>("room_paste_attachment", await source.arrayBuffer(), {
    headers: { "x-room-attachment": metadata },
  });
}

export function readRoomAttachment(id: string, attachmentId: string) {
  return invoke<ArrayBuffer>("room_read_attachment", { id, attachmentId });
}

export function discardRoomAttachment(id: string, attachmentId: string) {
  return invoke<void>("room_discard_attachment", { id, attachmentId });
}

export function revealRoomAttachment(id: string, attachmentId: string) {
  return invoke<void>("room_reveal_attachment", { id, attachmentId });
}
