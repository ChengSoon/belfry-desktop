import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { dispatchMcp } from "./mcp-dispatch.mjs";
import { apiError } from "./errors.mjs";
import { bindToolContext } from "./session-context.mjs";
import { activeContext } from "./execution.mjs";
import { textResult } from "./mcp-results.mjs";

const MAX_BODY = 1024 * 1024;
function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
async function readRequest(request) {
  const chunks = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > MAX_BODY) throw apiError("LIMIT_EXCEEDED", "MCP 请求过大"); chunks.push(chunk); }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || Array.isArray(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") throw apiError("INVALID_ARGUMENT", "MCP 请求格式无效");
  return value;
}
function validateSession(input) {
  if (typeof input.sessionId !== "string" || !input.sessionId || input.sessionId.length > 128 || !isAbsolute(input.workspace)) throw apiError("INVALID_ARGUMENT", "Agent 会话上下文无效");
  if (input.agentKind != null && !["codex", "claude"].includes(input.agentKind)) throw apiError("INVALID_ARGUMENT", "Agent 类型无效");
}
function validOrigin(request, origin) {
  return request.headers.host === origin.slice(7) && (!request.headers.origin || request.headers.origin === origin);
}
export class McpServer {
  constructor(manager) {
    this.manager = manager; this.sessions = new Map(); this.streams = new Map();
    this.server = createServer((request, response) => this.receive(request, response).catch((error) => {
      if (!response.headersSent) json(response, 400, { error: error.message }); else response.end();
    }));
    this.server.requestTimeout = 15_000; this.server.headersTimeout = 10_000;
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    this.origin = `http://127.0.0.1:${this.server.address().port}`; this.url = `${this.origin}/mcp`;
    return this;
  }
  async open(input) {
    validateSession(input);
    const workspace = await realpath(input.workspace);
    if (!(await stat(workspace)).isDirectory()) throw apiError("INVALID_ARGUMENT", "工作区不是目录");
    if (input.historyRoot != null && (typeof input.historyRoot !== "string" || !isAbsolute(input.historyRoot))) throw apiError("INVALID_ARGUMENT", "会话目录无效");
    this.revoke(input.sessionId);
    if (this.sessions.size >= 128) throw apiError("LIMIT_EXCEEDED", "Agent 插件连接过多");
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, { sessionId: input.sessionId, agentSession: input.agentSession, agentKind: input.agentKind,
      historyRoot: input.historyRoot, workspace, requests: 0, calls: new Map(), abort: new AbortController() });
    return { url: this.url, token };
  }
  revoke(sessionId) {
    for (const [token, session] of this.sessions) {
      if (session.sessionId !== sessionId) continue;
      session.expired = true;
      session.abort.abort(apiError("SESSION_EXPIRED", "Agent 会话已失效"));
      void this.manager.broker.browser.revoke(sessionId);
      for (const stream of this.streams.get(token) ?? []) stream.end();
      this.streams.delete(token); this.sessions.delete(token);
    }
  }
  async receive(request, response) {
    if (!validOrigin(request, this.origin)) return json(response, 403, { error: "Invalid origin" });
    const token = request.headers.authorization?.replace(/^Bearer /, ""), context = this.sessions.get(token);
    if (!context) return json(response, 401, { error: "Invalid or expired Agent session" });
    if (request.url !== "/mcp") return json(response, 404, { error: "Not found" });
    if (request.method === "GET") return this.subscribe(request, response, token);
    if (request.method !== "POST") return json(response, 405, { error: "Method not allowed" });
    if (!request.headers["content-type"]?.startsWith("application/json")) return json(response, 415, { error: "Expected application/json" });
    return this.post(context, request, response);
  }
  async post(context, request, response) {
    if (context.requests >= 16) return json(response, 429, { error: "Too many requests" });
    context.requests++;
    try {
      const message = await readRequest(request);
      if (context.expired) return json(response, 401, { error: "Agent 会话已失效" });
      let reply;
      try { reply = { jsonrpc: "2.0", id: message.id, result: await this.execute(context, message, response) }; }
      catch (error) { reply = { jsonrpc: "2.0", id: message.id, error: { code: error.code === "METHOD_NOT_FOUND" ? -32601 : -32602, message: error.message } }; }
      if (message.id === undefined) { response.writeHead(202); response.end(); } else json(response, 200, reply);
    } finally { context.requests--; }
  }
  async execute(context, message, response) {
    if (message.method === "notifications/cancelled") {
      context.calls.get(message.params?.requestId)?.abort(apiError("CANCELLED", "插件调用已取消")); return null;
    }
    if (message.id === undefined) return dispatchMcp(this.manager, message, context);
    if (context.calls.has(message.id)) throw apiError("INVALID_ARGUMENT", "MCP 请求 ID 重复");
    bindToolContext(context, message);
    const controller = new AbortController(); context.calls.set(message.id, controller);
    const scoped = Object.assign(Object.create(context), { abort: { signal: AbortSignal.any([context.abort.signal, controller.signal]) } });
    const disconnect = () => { if (!response.writableEnded) controller.abort(apiError("CANCELLED", "Agent 已断开本次请求")); };
    response.once("close", disconnect);
    try { const result = await dispatchMcp(this.manager, message, scoped); activeContext(scoped); return result; }
    catch (error) {
      if (message.method === "tools/call") return { ...textResult(error.message), isError: true };
      throw error;
    }
    finally { response.off("close", disconnect); context.calls.delete(message.id); }
  }
  subscribe(request, response, token) {
    const streams = this.streams.get(token) ?? new Set();
    if (streams.size >= 4) return json(response, 429, { error: "Too many event streams" });
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
    response.write(": ready\n\n"); streams.add(response); this.streams.set(token, streams);
    request.on("close", () => streams.delete(response));
  }
  changed() {
    for (const streams of this.streams.values()) for (const response of streams) {
      for (const group of ["tools", "prompts", "resources"]) response.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: `notifications/${group}/list_changed` })}\n\n`);
    }
  }
  async close() {
    for (const session of [...this.sessions.values()]) this.revoke(session.sessionId);
    this.server.closeAllConnections();
    if (this.server.listening) await new Promise((resolve) => this.server.close(resolve));
  }
}
