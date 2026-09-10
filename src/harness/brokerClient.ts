import { invoke } from "@tauri-apps/api/core";
import type { BrokerAuditEvent, BrokerToolRequest, RpcResponse } from "./protocol";
import type { WorkerTransport } from "./supervisor";

interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
const defaultBridge: Bridge = { invoke: (command, args) => invoke(command, args) };

export class BrokerClient {
  constructor(private readonly bridge: Bridge = defaultBridge) {}
  register(registration: Record<string, unknown>) { return this.bridge.invoke("harness_broker_register", { registration }); }
  updateGrants(sessionId: string, grants: string[]) { return this.bridge.invoke("harness_broker_update_grants", { sessionId, grants }); }
  cancel(sessionId: string) { return this.bridge.invoke("harness_broker_cancel", { sessionId }); }

  async route(workerId: string, value: unknown, transport: WorkerTransport) {
    if (!isToolRequest(value)) return false;
    let response: RpcResponse;
    try {
      const result = await this.bridge.invoke("harness_broker_handle", {
        workerId,
        request: { sessionId: value.sessionId, requestId: value.id, toolId: value.params.toolId, tool: value.params.tool, params: { path: value.params.path } },
      });
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, result };
    } catch (failure) {
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, error: normalizeError(failure) };
    }
    transport.send(response);
    return true;
  }
}

export function normalizeAudit(value: unknown): BrokerAuditEvent | undefined {
  if (!isRecord(value) || !["requested", "completed", "failed"].includes(String(value.phase))) return undefined;
  if (!["sessionId", "requestId", "toolId", "tool", "summary"].every((key) => typeof value[key] === "string")) return undefined;
  if (typeof value.durationMs !== "number") return undefined;
  return value as unknown as BrokerAuditEvent;
}

function isToolRequest(value: unknown): value is BrokerToolRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.method !== "tool/request" || typeof value.id !== "string" || typeof value.sessionId !== "string" || !isRecord(value.params)) return false;
  return typeof value.params.toolId === "string" && ["project.list", "project.read"].includes(String(value.params.tool));
}
function normalizeError(value: unknown) {
  if (isRecord(value) && typeof value.code === "string" && typeof value.message === "string") return { code: value.code, message: value.message };
  return { code: "IO_ERROR", message: "broker request failed" };
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
