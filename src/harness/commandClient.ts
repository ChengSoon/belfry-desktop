import type { CommandAuditEvent, CommandToolRequest, RpcResponse } from "./protocol";
import type { WorkerTransport } from "./supervisor";

interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
interface Approval { approvalId: string; expiresAt: number }

export class CommandClient {
  constructor(
    private readonly bridge: Bridge,
    private readonly confirm: (approval: Approval, request: CommandToolRequest) => Promise<boolean>,
  ) {}

  async route(workerId: string, value: unknown, transport: WorkerTransport) {
    if (!isCommandRequest(value)) return false;
    let response: RpcResponse;
    try {
      const request = toHostRequest(workerId, value);
      const approval = await this.bridge.invoke("harness_command_request", { request }) as Approval;
      if (!await this.confirm(approval, value)) {
        await this.bridge.invoke("harness_command_reject", { approvalId: approval.approvalId });
        throw { code: "APPROVAL_DENIED", message: "command approval denied" };
      }
      const approvalToken = await this.bridge.invoke("harness_command_approve", { approvalId: approval.approvalId });
      const result = await this.bridge.invoke("harness_command_execute", { approvalId: approval.approvalId, approvalToken });
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, result };
    } catch (failure) {
      response = { jsonrpc: "2.0", id: value.id, sessionId: value.sessionId, error: normalizeError(failure) };
    }
    transport.send(response);
    return true;
  }
}

export function normalizeCommandAudit(value: unknown): CommandAuditEvent | undefined {
  if (!isRecord(value) || !["requested", "approval.required", "started", "output", "completed", "failed", "cancelled"].includes(String(value.phase))) return;
  if (!["sessionId", "requestId", "toolId", "summary"].every((key) => typeof value[key] === "string") || typeof value.durationMs !== "number") return;
  if (value.stream !== undefined && !["stdout", "stderr"].includes(String(value.stream))) return;
  return value as unknown as CommandAuditEvent;
}

function toHostRequest(workerId: string, request: CommandToolRequest) {
  const { toolId: _, tool: __, ...command } = request.params;
  return { sessionId: request.sessionId, workerId, requestId: request.id, toolId: request.params.toolId, ...command };
}
function isCommandRequest(value: unknown): value is CommandToolRequest {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.method !== "tool/request" || typeof value.id !== "string" || typeof value.sessionId !== "string" || !isRecord(value.params)) return false;
  return value.params.tool === "command.exec" && typeof value.params.toolId === "string" && typeof value.params.executable === "string" && (value.params.argv === undefined || Array.isArray(value.params.argv));
}
function normalizeError(value: unknown) { return isRecord(value) && typeof value.code === "string" && typeof value.message === "string" ? { code: value.code, message: value.message } : { code: "COMMAND_FAILED", message: "command request failed" }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
