import { apiError } from "./errors.mjs";

export const MAX_MESSAGE = 1024 * 1024;
export function encodeMessage(message) {
  const text = JSON.stringify(message);
  if (Buffer.byteLength(text) >= MAX_MESSAGE) throw apiError("LIMIT_EXCEEDED", "插件消息超过 1 MiB，请减少返回内容或分块读取");
  return text;
}
