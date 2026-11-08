import { t } from "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { RoomAttachment } from "./contracts";

/** 打开系统的文件选择框，返回选中文件的路径。 */
export function pickRoomAttachments() {
  return invoke<string[]>("room_pick_attachments");
}

/** 剪贴板里从 Finder / 资源管理器复制的文件路径（浏览器拿不到这些）。只在用户粘贴时调用。 */
export function clipboardRoomFiles() {
  return invoke<string[]>("room_clipboard_files");
}

/** 导入一个附件：路径走普通 IPC；粘贴、拖入的文件内容走原始二进制，不膨胀成 JSON 数组。 */
export async function importRoomAttachment(id: string, source: File | string) {
  if (typeof source === "string") return invoke<RoomAttachment>("room_import_attachment", { id, source });
  const extension = source.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin";
  const name = source.name || t("rooms.attachmentApi.text_3d1ead730b", { extension: extension });
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
