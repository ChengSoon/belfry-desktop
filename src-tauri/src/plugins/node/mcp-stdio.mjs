import { createInterface } from "node:readline";

const url = process.env.BELFRY_PLUGIN_MCP_URL, token = process.env.BELFRY_PLUGIN_MCP_TOKEN;
const parsed = new URL(url ?? "http://invalid");
if (parsed.protocol !== "http:" || parsed.hostname !== "127.0.0.1" || !parsed.port || !token) {
  process.stderr.write("Belfry 插件 MCP 仅供应用创建的 Agent 会话使用。\n"); process.exit(1);
}
const authorization = `Bearer ${token}`, controller = new AbortController();
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
async function events() {
  try {
    const response = await fetch(url, { headers: { Authorization: authorization, Accept: "text/event-stream" }, signal: controller.signal });
    if (!response.ok || !response.body) return;
    const decoder = new TextDecoder(); let buffer = "";
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      if (buffer.length > 1024 * 1024) throw new Error("MCP event too large");
      let end;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = event.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
        if (data) send(JSON.parse(data));
      }
    }
  } catch (error) { if (!controller.signal.aborted) process.stderr.write(`Plugin MCP events: ${error.message}\n`); }
}
let eventsStarted = false;
async function forward(line) {
  let request;
  try {
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("MCP message too large");
    request = JSON.parse(line);
    const response = await fetch(url, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body: line,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(115_000)]) });
    if (!response.ok) throw new Error(`Belfry plugin MCP ${response.status}`);
    if (response.status !== 202) send(await response.json());
    if (request.method === "initialize" && !eventsStarted) { eventsStarted = true; void events(); }
  } catch (error) {
    if (request?.id !== undefined) send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: error.message } });
    else process.stderr.write(`Plugin MCP: ${error.message}\n`);
  }
}
createInterface({ input: process.stdin }).on("line", (line) => void forward(line)).on("close", () => controller.abort());
