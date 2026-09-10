import readline from "node:readline";
const mode = process.argv[2] ?? "normal";
const modeArgs = process.argv.slice(3);
const sequences = new Map();
const sessions = new Set();
const output = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
const event = (type, sessionId, requestId, data) => {
  const sequence = (sequences.get(sessionId) ?? 0) + 1;
  sequences.set(sessionId, sequence);
  return { event: { schemaVersion: 1, type, sequence, timestamp: Date.now(), sessionId, requestId, data } };
};

if (mode === "invalid-json") process.stdout.write("{broken}\n");
if (mode === "invalid-utf8") process.stdout.write(Buffer.from([0xff, 0x0a]));
if (mode === "oversized") process.stdout.write(`${"x".repeat(1024 * 1024 + 1)}\n`);
if (mode === "invalid-envelope") output({ valid: "json", but: "not rpc" });
if (mode === "nonzero") process.exit(7);
if (mode === "stderr") process.stderr.write("fake worker diagnostic\n");

let writeQueue = Promise.resolve();
const respond = (value) => {
  const text = `${JSON.stringify(value)}\n`;
  if (mode !== "chunked") { process.stdout.write(text); return Promise.resolve(); }
  const middle = Math.max(1, Math.floor(text.length / 2));
  writeQueue = writeQueue.then(() => new Promise((resolve) => {
    process.stdout.write(text.slice(0, middle));
    setImmediate(() => { process.stdout.write(text.slice(middle)); resolve(); });
  }));
  return writeQueue;
};

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  let request;
  try { request = JSON.parse(line); } catch { output({ jsonrpc: "2.0", id: "unknown", error: { code: "INVALID_JSON", message: "invalid JSON" } }); return; }
  const sessionId = request.sessionId ?? "worker";
  if (request.method === "initialize") {
    respond({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1, capabilities: ["mock.echo"], argv: modeArgs, envKeys: Object.keys(process.env) } });
    if (mode === "broker-request") respond({ jsonrpc: "2.0", id: "broker-1", method: "tool/request", sessionId: "session-a", params: { toolId: "tool-1", tool: "project.read", path: "hello.txt" } });
    if (mode === "patch-roundtrip") respond({ jsonrpc: "2.0", id: "patch-propose", method: "tool/request", sessionId: "session-a", params: { toolId: "patch-1", tool: "project.patch.propose", relativePath: modeArgs[0], expectedDigest: modeArgs[1], replacement: modeArgs[2] } });
    if (mode === "command-roundtrip") respond({ jsonrpc: "2.0", id: "command-1", method: "tool/request", sessionId: "session-a", params: { toolId: "command-tool", tool: "command.exec", executable: "echo", argv: ["hello worker"] } });
  }
  else if (!request.method && request.id === "patch-propose" && request.result) {
    respond({ jsonrpc: "2.0", id: "patch-apply", method: "tool/request", sessionId: "session-a", params: { toolId: "patch-2", tool: "project.patch.apply", previewId: request.result.previewId, approvalToken: request.result.approvalToken } });
  }
  else if (!request.method && request.id === "patch-apply" && request.result) {
    respond(event("patch.completed", "session-a", "patch-apply", { applied: true }));
  }
  else if (!request.method && request.id === "command-1" && request.result) {
    respond(event("command.completed", "session-a", "command-1", request.result));
  }
  else if (!request.method && ("result" in request || "error" in request)) return;
  else if (request.method === "session/start") { sessions.add(sessionId); respond(event("session.started", sessionId, request.id)); respond({ jsonrpc: "2.0", id: request.id, sessionId, result: { sessionId } }); }
  else if (request.method === "tool/request") { respond(event("tool.requested", sessionId, request.id, { tool: "mock.echo" })); respond({ jsonrpc: "2.0", id: request.id, sessionId, result: { output: request.params ?? null } }); }
  else if (request.method === "cancel") { respond(event("session.cancelled", sessionId, request.id)); respond({ jsonrpc: "2.0", id: request.id, sessionId, result: { cancelled: true } }); }
  else if (request.method === "shutdown") {
    if (mode === "stubborn") return;
    respond({ jsonrpc: "2.0", id: request.id, result: { ok: true } }).then(() => process.exit(0));
  }
  else if (!sessions.has(sessionId)) respond({ jsonrpc: "2.0", id: request.id, sessionId, error: { code: "SESSION_NOT_FOUND", message: "session not started" } });
  else respond({ jsonrpc: "2.0", id: request.id, sessionId, error: { code: "UNSUPPORTED_METHOD", message: request.method } });
});
