import type { HarnessEvent, RpcRequest, RpcResponse } from "./protocol";

export interface WorkerTransport { send(request: RpcRequest | RpcResponse): void; close(): void }
interface PendingRequest { method: string; sessionId?: string; timer?: ReturnType<typeof setTimeout> }
interface SupervisorOptions { nextRequestId?: () => string; now?: () => number }
interface Failure { code: string; message?: string; data?: unknown }

export class HarnessSupervisor {
  private readonly sequences = new Map<string, number>();
  private readonly pending = new Map<string, PendingRequest>();
  private readonly completed = new Set<string>();
  private readonly nextRequestId: () => string;
  private readonly now: () => number;
  private closed = false;

  constructor(
    private readonly transport: WorkerTransport,
    private readonly emit: (event: HarnessEvent) => void,
    options: SupervisorOptions = {},
  ) {
    this.nextRequestId = options.nextRequestId ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
  }

  initialize() { return this.send("initialize"); }
  start(sessionId: string) { return this.send("session/start", sessionId); }
  cancel(sessionId: string) { return this.send("cancel", sessionId); }

  requestModel(sessionId: string, prompt: string, timeoutMs = 15_000) {
    const id = this.send("model/request", sessionId, { prompt });
    const pending = this.pending.get(id)!;
    pending.timer = setTimeout(() => {
      if (!this.pending.delete(id)) return;
      this.completed.add(id);
      this.emitFailure(sessionId, id, { code: "TIMEOUT" });
      if (!this.closed) this.cancel(sessionId);
    }, timeoutMs);
    return id;
  }

  handle(message: unknown) {
    if (this.closed) return false;
    if (isEventMessage(message)) return this.handleEvent(message.event);
    if (isRpcResponse(message)) return this.handleResponse(message);
    this.emitFailure("unknown", undefined, { code: "INVALID_MESSAGE" });
    return false;
  }

  crashed(failure: Failure = { code: "WORKER_CRASHED" }) { this.finish(failure); }
  close() { this.finish({ code: "WORKER_CLOSED" }); }

  private send(method: string, sessionId?: string, params?: unknown) {
    if (this.closed) throw new Error("Harness worker is closed");
    const id = this.nextRequestId();
    if (this.pending.has(id) || this.completed.has(id)) throw new Error(`Duplicate request ID: ${id}`);
    this.pending.set(id, { method, sessionId });
    this.transport.send({ jsonrpc: "2.0", id, method, sessionId, params });
    return id;
  }

  private handleEvent(event: HarnessEvent) {
    const previous = this.sequences.get(event.sessionId) ?? 0;
    if (event.sequence <= previous) return false;
    this.sequences.set(event.sessionId, event.sequence);
    this.emit(event);
    return true;
  }

  private handleResponse(response: RpcResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) {
      const code = this.completed.has(response.id) ? "DUPLICATE_RESPONSE" : "UNKNOWN_RESPONSE";
      this.emitFailure(response.sessionId ?? "unknown", response.id, { code });
      return false;
    }
    if (response.sessionId && response.sessionId !== pending.sessionId) {
      this.emitFailure(pending.sessionId ?? "unknown", response.id, { code: "RESPONSE_SESSION_MISMATCH" });
      return false;
    }
    this.settle(response.id, pending);
    if (!response.error) return true;
    this.emitFailure(pending.sessionId ?? "unknown", response.id, response.error);
    return false;
  }

  private settle(id: string, pending: PendingRequest) {
    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(id);
    this.completed.add(id);
  }

  private finish(failure: Failure) {
    if (this.closed) return;
    this.closed = true;
    for (const [id, pending] of this.pending) {
      this.settle(id, pending);
      this.emitFailure(pending.sessionId ?? "worker", id, { ...failure, data: { method: pending.method } });
    }
    this.transport.close();
  }

  private emitFailure(sessionId: string, requestId: string | undefined, failure: Failure) {
    const sequence = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, sequence);
    this.emit({ schemaVersion: 1, type: "session.failed", sequence, timestamp: this.now(), sessionId, requestId, data: failure });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEventMessage(value: unknown): value is { event: HarnessEvent } {
  if (!isRecord(value) || !isRecord(value.event)) return false;
  const event = value.event;
  return event.schemaVersion === 1 && typeof event.type === "string" &&
    Number.isInteger(event.sequence) && (event.sequence as number) > 0 &&
    typeof event.timestamp === "number" && typeof event.sessionId === "string";
}

function isRpcResponse(value: unknown): value is RpcResponse {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || typeof value.id !== "string") return false;
  const hasResult = Object.hasOwn(value, "result");
  const hasError = isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
  return hasResult !== hasError && (value.sessionId === undefined || typeof value.sessionId === "string");
}
