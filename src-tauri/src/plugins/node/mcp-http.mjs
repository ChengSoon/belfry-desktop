import { setTimeout as delay } from "node:timers/promises";
import { httpUrl } from "./network.mjs";
import { mcpResponse } from "./mcp-response.mjs";
import { mcpEvents } from "./mcp-events.mjs";
import { apiError } from "./errors.mjs";

export class McpHttp {
  constructor(peer, headers) { this.peer = peer; this.url = httpUrl(peer.descriptor.url).href; this.configuredHeaders = headers; }
  headers() {
    return { ...this.configuredHeaders, "MCP-Protocol-Version": this.peer.initialized?.protocolVersion ?? "2024-11-05",
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}) };
  }
  async post(message, signal) {
    const response = await fetch(this.url, { method: "POST", headers: { ...this.headers(), "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify(message), redirect: "error", signal });
    if (!response.ok) { await response.body?.cancel(); throw apiError("MCP_ERROR", `MCP HTTP ${response.status}`); }
    const session = response.headers.get("mcp-session-id");
    if (session && this.sessionId && session !== this.sessionId) { await response.body?.cancel(); throw apiError("MCP_ERROR", "MCP 服务意外切换会话标识"); }
    this.sessionId ??= session;
    if (response.status === 202) { await response.body?.cancel(); return null; }
    const result = await mcpResponse(response, message.id, (value) => this.peer.notice(value));
    if (result?.error) throw Object.assign(apiError("MCP_ERROR", result.error.message), { rpcCode: result.error.code });
    return result?.result;
  }
  watch() {
    if (this.watching || !["tools", "prompts", "resources"].some((group) => this.peer.initialized?.capabilities?.[group]?.listChanged)) return;
    this.watching = this.subscribe().catch((error) => { if (!this.peer.stopping) this.peer.log(error.message); });
  }
  async subscribe() {
    const signal = AbortSignal.any([this.peer.abort.signal, this.peer.entry.abort.signal]); let retry = 1000;
    while (!signal.aborted) {
      try {
        const response = await fetch(this.url, { headers: { ...this.headers(), Accept: "text/event-stream" }, redirect: "error", signal });
        if ([400, 401, 403, 404, 405].includes(response.status)) { await response.body?.cancel(); return; }
        if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
          await response.body?.cancel(); throw apiError("MCP_ERROR", `MCP 通知订阅失败（${response.status}）`);
        }
        retry = 1000;
        for await (const message of mcpEvents(response.body)) this.peer.notice(message);
      } catch (error) { if (signal.aborted) return; this.peer.log(error.message); }
      await delay(retry, undefined, { signal }).catch(() => {}); retry = Math.min(retry * 2, 30_000);
    }
  }
  async stop() {
    await this.watching;
    if (this.sessionId) await fetch(this.url, { method: "DELETE", headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(1000) })
      .then((response) => response.body?.cancel()).catch(() => {});
  }
}
