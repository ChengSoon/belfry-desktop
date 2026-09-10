import readline from "node:readline";
const out = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request; try { request = JSON.parse(line); } catch { out({ jsonrpc: "2.0", id: "unknown", error: { code: "INVALID_JSON", message: "invalid request" } }); return; }
  if (request.method === "initialize") { out({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, capabilities: ["project.list", "project.read"] } }); return; }
  if (request.method === "session/start") { out({ jsonrpc: "2.0", id: request.id, sessionId: request.sessionId, result: { sessionId: request.sessionId } }); return; }
  if (request.method === "shutdown") { out({ jsonrpc: "2.0", id: request.id, result: { ok: true } }); process.exit(0); }
  if (request.method === "tool/request") {
    const tool = request.params?.tool;
    if (tool !== "project.list" && tool !== "project.read") { out({ jsonrpc: "2.0", id: request.id, sessionId: request.sessionId, error: { code: "UNSUPPORTED_TOOL", message: "example only supports project list/read" } }); return; }
    out({ jsonrpc: "2.0", id: request.id, sessionId: request.sessionId, result: { note: tool === "project.list" ? "宿主将返回项目文件列表" : "宿主将返回指定安全文本文件" } });
  }
});
