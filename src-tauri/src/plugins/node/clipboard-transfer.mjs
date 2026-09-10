import { randomUUID } from "node:crypto";
import { apiError } from "./errors.mjs";
import { ClipboardHistory, MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from "./clipboard-history.mjs";

const CHUNK_BYTES = 128 * 1024, PAGE_BYTES = 512 * 1024, TRANSFER_TTL = 5 * 60 * 1000;
function prune(map) { for (const [key, value] of map) if (value.expires < Date.now()) map.delete(key); }
export class ClipboardTransfer {
  constructor() { this.history = new ClipboardHistory(); this.captures = new Map(); this.snapshots = new Map(); }
  text(text) {
    if (typeof text !== "string") throw apiError("INVALID_ARGUMENT", "剪贴板文本无效");
    if (Buffer.byteLength(text) <= MAX_TEXT_BYTES) this.history.record({ type: "text", text });
    return null;
  }
  capture(method, input) {
    prune(this.captures);
    if (method === "text") return this.text(input.text);
    if (method === "begin") return this.begin(input);
    const value = this.captures.get(input.id);
    if (!value) throw apiError("NOT_FOUND", "图片捕获已失效");
    if (method === "cancel") { this.captures.delete(input.id); return null; }
    if (method === "chunk") return appendCapture(value, input);
    if (method !== "finish") throw apiError("UNSUPPORTED", "未知剪贴板捕获操作");
    this.captures.delete(input.id);
    if (value.length !== value.size) throw apiError("INVALID_ARGUMENT", "图片捕获未完成");
    const { format, width, height } = value;
    this.history.record({ type: "image", format, width, height, data: Buffer.concat(value.chunks) });
    return null;
  }
  begin(input) {
    const { format, size, width, height } = input;
    if (!["png", "jpeg", "webp"].includes(format) || !Number.isSafeInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES
      || ![width, height].every((number) => Number.isSafeInteger(number) && number > 0 && number <= 100_000)) throw apiError("INVALID_ARGUMENT", "剪贴板图片无效或超额");
    if (this.captures.size >= 2) throw apiError("BUSY", "正在捕获剪贴板图片");
    const id = randomUUID();
    this.captures.set(id, { format, size, width, height, chunks: [], length: 0, expires: Date.now() + TRANSFER_TTL });
    return { id };
  }
  call(owner, api, input = {}) {
    prune(this.snapshots);
    if (api === "clipboard.getHistory") {
      if (this.snapshots.size >= 8) throw apiError("BUSY", "正在读取剪贴板历史，请稍后重试");
      const snapshot = randomUUID();
      this.snapshots.set(snapshot, { owner, entries: this.history.snapshot(), expires: Date.now() + TRANSFER_TTL });
      return { snapshot };
    }
    const value = this.snapshots.get(input.snapshot);
    if (!value || value.owner !== owner) throw apiError("NOT_FOUND", "剪贴板历史快照已失效");
    if (api === "clipboard.releaseHistory") { this.snapshots.delete(input.snapshot); return null; }
    if (api === "clipboard.historyPage") return this.page(value.entries, input.offset);
    if (api === "clipboard.imageChunk") {
      return imageChunk(value.entries[input.index], input.offset);
    }
    throw apiError("UNSUPPORTED", "未知剪贴板历史操作");
  }
  page(entries, offset) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entries.length) throw apiError("INVALID_ARGUMENT", "剪贴板页码无效");
    const items = []; let size = 0, index = offset;
    while (index < entries.length) {
      const entry = entries[index], { data, ...metadata } = entry;
      const bytes = Buffer.byteLength(JSON.stringify(metadata)) + 128;
      if (items.length && size + bytes > PAGE_BYTES) break;
      items.push({ ...metadata, index, byteLength: data?.length }); size += bytes; index++;
    }
    return { items, nextOffset: index < entries.length ? index : null };
  }
}
function appendCapture(value, input) {
  if (input.offset !== value.length || typeof input.data !== "string" || input.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)) throw apiError("INVALID_ARGUMENT", "图片分块无效");
  const bytes = Buffer.from(input.data, "base64");
  if (!bytes.length || bytes.length > CHUNK_BYTES || value.length + bytes.length > value.size) throw apiError("LIMIT_EXCEEDED", "图片分块超额");
  value.chunks.push(bytes); value.length += bytes.length; return null;
}
function imageChunk(entry, offset) {
  if (entry?.type !== "image" || !Number.isSafeInteger(offset) || offset < 0 || offset > entry.data.length) throw apiError("INVALID_ARGUMENT", "剪贴板图片范围无效");
  return entry.data.subarray(offset, offset + CHUNK_BYTES).toString("base64");
}
