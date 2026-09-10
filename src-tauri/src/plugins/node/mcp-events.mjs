import { apiError } from "./errors.mjs";

const EVENT_BYTES = 512 * 1024;
export async function* mcpEvents(body) {
  const decoder = new TextDecoder(); let buffer = "", data = "";
  for await (const chunk of body ?? []) {
    buffer += decoder.decode(chunk, { stream: true });
    if (Buffer.byteLength(buffer) + Buffer.byteLength(data) > EVENT_BYTES) throw apiError("LIMIT_EXCEEDED", "MCP 事件过大");
    let end;
    while ((end = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, end).replace(/\r$/, ""); buffer = buffer.slice(end + 1);
      if (line.startsWith("data:")) data += line.slice(5).replace(/^ /, "") + "\n";
      if (!line && data) { const value = data; data = ""; yield JSON.parse(value); }
    }
  }
}
