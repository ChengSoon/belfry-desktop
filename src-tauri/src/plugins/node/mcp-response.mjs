import { boundedBody } from "./network.mjs";
import { apiError } from "./errors.mjs";
import { mcpEvents } from "./mcp-events.mjs";

const LIMIT = 512 * 1024;
function checked(message, id) {
  if (!message || message.jsonrpc !== "2.0" || message.id !== id || !("result" in message || "error" in message)) throw apiError("MCP_ERROR", "MCP 响应标识或内容无效");
  return message;
}
export async function mcpResponse(response, id, notify = () => {}) {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) return checked(JSON.parse(await boundedBody(response, LIMIT)), id);
  let events = 0;
  for await (const message of mcpEvents(response.body)) {
    if (message.id === id) return checked(message, id);
    if (++events > 1024) throw apiError("LIMIT_EXCEEDED", "MCP 响应事件过多");
    notify(message);
  }
  throw apiError("MCP_ERROR", "MCP 响应缺少结果");
}
