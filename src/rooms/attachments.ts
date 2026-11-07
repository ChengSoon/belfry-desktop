import type { RoomAttachment } from "./contracts";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export function isPreviewImage(mimeType: string) {
  return /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(mimeType);
}

export function attachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** files 与 items 常指向同一批文件，只读取一份；普通文字留给输入框。 */
export function transferFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items).filter((item) => item.kind === "file")
    .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
}

export function messageExcerpt(message: { text: string; attachments?: RoomAttachment[] }) {
  return message.text || (message.attachments ?? []).map((attachment) => attachment.name).join("、");
}
