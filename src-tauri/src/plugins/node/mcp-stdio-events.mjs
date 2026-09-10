import { setTimeout as delay } from "node:timers/promises";
import { mcpEvents } from "./mcp-events.mjs";

const INITIAL_RETRY_MS = 250;
const MAX_RETRY_MS = 5000;
const CATALOG_GROUPS = ["tools", "prompts", "resources"];

async function acceptSubscription(response) {
  if ([401, 403, 410].includes(response.status)) { await response.body?.cancel(); return false; }
  if (!response.ok || !response.body) {
    await response.body?.cancel(); throw new Error(`Belfry plugin MCP events ${response.status}`);
  }
  return true;
}

export async function catalogEvents({ url, authorization, signal, send, report }) {
  let retryMs = INITIAL_RETRY_MS;
  while (!signal.aborted) {
    try {
      const response = await fetch(url, { headers: { Authorization: authorization, Accept: "text/event-stream" }, signal });
      if (!await acceptSubscription(response)) return;
      // 建连和重连都补发目录通知，覆盖订阅建立前及断线期间的变化。
      for (const group of CATALOG_GROUPS) send({ jsonrpc: "2.0", method: `notifications/${group}/list_changed` });
      for await (const message of mcpEvents(response.body)) {
        if (signal.aborted) return;
        send(message); retryMs = INITIAL_RETRY_MS;
      }
    } catch (error) {
      if (signal.aborted) return;
      report(error.message);
    }
    try { await delay(retryMs, undefined, { signal }); } catch { return; }
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
  }
}
