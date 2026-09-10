import { createInterface } from "node:readline";
import { catalogEvents } from "./mcp-stdio-events.mjs";

const url = process.env.BELFRY_PLUGIN_MCP_URL, token = process.env.BELFRY_PLUGIN_MCP_TOKEN;
const parsed = new URL(url ?? "http://invalid");
if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || !token) {
  process.stderr.write("Belfry 插件 MCP 仅供应用创建的 Agent 会话使用。\n"); process.exit(1);
}
const authorization = `Bearer ${token}`, controller = new AbortController();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const EVENT_START_METHODS = new Set(["notifications/initialized", "tools/list", "prompts/list", "resources/list", "resources/templates/list"]);
let initialized = false, eventsStarted = false;
async function publishReply(response, method) {
  const reply = response.status === 202 ? null : await response.json();
  if (reply) send(reply);
  if (method === "initialize") initialized = !!reply?.result;
  if (initialized && EVENT_START_METHODS.has(method) && !eventsStarted) {
    eventsStarted = true;
    void catalogEvents({ url, authorization, signal: controller.signal, send,
      report: (message) => process.stderr.write(`Plugin MCP events: ${message}\n`) });
  }
}
async function forward(line) {
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("MCP message too large");
    request = JSON.parse(line);
    const response = await fetch(url, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: line,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(115_000)]) });
    if (!response.ok) throw new Error(`Belfry plugin MCP ${response.status}`);
    await publishReply(response, request.method);
  } catch (error) {
    if (request?.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } });
    else process.stderr.write(`Plugin MCP: ${error.message}\n`);
  }
}
createInterface({ input: process.stdin }).on("line", (line) => void forward(line)).on("close", () => controller.abort());
