import type { RoomAttachment, RoomMessage } from "./contracts";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

/** 浏览器能安全预览的位图格式；SVG 不在内（可能带脚本）。 */
export function isPreviewImage(mimeType: string) {
  return /^image\/(png|jpeg|gif|webp|bmp|avif)$/.test(mimeType);
}

export function attachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** 文件扩展名（大写），没有扩展名时为空串。附件卡片上当类型标签。 */
export function attachmentExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toUpperCase().slice(0, 5) : "";
}

/** files 与 items 常指向同一批文件，只读取一份；普通文字留给输入框。 */
export function transferFiles(data: DataTransfer): File[] {
  const files = Array.from(data.files);
  if (files.length) return files;
  return Array.from(data.items).filter((item) => item.kind === "file")
    .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
}

/** 一句话摘要：有正文用正文，只有附件时列出文件名。引用、回复横幅用它。与 Rust `attachments::summary` 一致。 */
export function messageSummary(message: Pick<RoomMessage, "text" | "attachments">) {
  if (message.text.trim() || !message.attachments?.length) return message.text;
  return `[附件] ${message.attachments.map((attachment: RoomAttachment) => attachment.name).join("、")}`;
}
