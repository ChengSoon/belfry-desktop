import { invoke } from "@tauri-apps/api/core";
export type AuditPhase = "requested" | "approval.required" | "started" | "output" | "completed" | "failed" | "cancelled";
export interface HarnessAuditEvent { id: string; timestamp: number; phase: AuditPhase | string; sessionId: string; workerId?: string; pluginId?: string; version?: string; requestId: string; toolId: string; durationMs: number; summary: string; errorCode?: string; truncated: boolean }
export interface AuditQuery { sessionId?: string; workerId?: string; pluginId?: string; version?: string; cursor?: number; limit?: number }
export interface AuditPage { events: HarnessAuditEvent[]; nextCursor?: number; total: number }
interface Bridge { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> }
const bridge: Bridge = { invoke: (command, args) => invoke(command, args) };
export class HarnessAuditClient {
  constructor(private readonly host: Bridge = bridge) {}
  async query(query: AuditQuery = {}): Promise<AuditPage> {
    const value = await this.host.invoke("harness_audit_query", { query });
    if (!isRecord(value) || !Array.isArray(value.events) || typeof value.total !== "number") throw new Error("Invalid Harness audit page");
    const events = value.events.map(normalizeAudit).filter((event): event is HarnessAuditEvent => Boolean(event));
    return { events, total: value.total, nextCursor: typeof value.nextCursor === "number" ? value.nextCursor : undefined };
  }
}
export function normalizeAudit(value: unknown): HarnessAuditEvent | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.timestamp !== "number" || typeof value.phase !== "string" || typeof value.sessionId !== "string" || typeof value.requestId !== "string" || typeof value.toolId !== "string" || typeof value.durationMs !== "number" || typeof value.summary !== "string" || typeof value.truncated !== "boolean") return;
  return { ...value, summary: value.summary.slice(0, 512) } as HarnessAuditEvent;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
