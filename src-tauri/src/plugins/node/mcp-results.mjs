import { apiError } from "./errors.mjs";
import { mcpToolResult } from "./mcp-validation.mjs";

export const textResult = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value ?? null) }] });
function image(value) {
  if (!value || typeof value.mimeType !== "string" || !/^image\/[a-zA-Z0-9.+-]+$/.test(value.mimeType)
    || typeof value.data !== "string" || !value.data || value.data.length % 4 !== 0 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(value.data)) {
    throw apiError("INVALID_RESULT", "插件图片结果格式无效");
  }
  return { type: "image", mimeType: value.mimeType, data: value.data };
}
export function toolResult(value) {
  if (value && Array.isArray(value.content)) return mcpToolResult(value);
  if (!value || !Array.isArray(value.images)) return textResult(value);
  if (value.images.length > 16) throw apiError("LIMIT_EXCEEDED", "插件一次返回的图片过多");
  const { images, ...metadata } = value;
  return { content: [...textResult(metadata).content, ...images.map(image)], ...(value.isError === true ? { isError: true } : {}) };
}
