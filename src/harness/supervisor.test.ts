import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessSupervisor, type WorkerTransport } from "./supervisor";

function transport() {
  return { send: vi.fn(), close: vi.fn() } satisfies WorkerTransport;
}

function event(sessionId: string, sequence: number) {
  return { event: { schemaVersion: 1 as const, type: "session.started", sequence, timestamp: 1, sessionId } };
}

describe("HarnessSupervisor", () => {
  afterEach(() => vi.useRealTimers());

  it("tracks event sequence independently for every session", () => {
    const emitted: unknown[] = [];
    const supervisor = new HarnessSupervisor(transport(), emitted.push.bind(emitted), { nextRequestId: () => "unused" });
    expect(supervisor.handle(event("first", 1))).toBe(true);
    expect(supervisor.handle(event("second", 1))).toBe(true);
    expect(supervisor.handle(event("first", 1))).toBe(false);
    expect(supervisor.handle(event("second", 2))).toBe(true);
    expect(emitted).toHaveLength(3);
  });

  it("uses injected deterministic request IDs", () => {
    const worker = transport();
    const ids = ["request-1", "request-2"];
    const supervisor = new HarnessSupervisor(worker, vi.fn(), { nextRequestId: () => ids.shift()! });
    expect(supervisor.initialize()).toBe("request-1");
    expect(supervisor.start("session-a")).toBe("request-2");
    expect(worker.send).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: "request-2", method: "session/start", sessionId: "session-a" }));
  });

  it("rejects unknown, duplicate, and wrong-session responses", () => {
    vi.useFakeTimers();
    const emitted: any[] = [];
    const supervisor = new HarnessSupervisor(transport(), (value) => emitted.push(value), { nextRequestId: () => "model-1" });
    supervisor.requestModel("session-a", "hello", 100);
    expect(supervisor.handle({ jsonrpc: "2.0", id: "unknown", result: {} })).toBe(false);
    expect(supervisor.handle({ jsonrpc: "2.0", id: "model-1", sessionId: "other", result: {} })).toBe(false);
    expect(supervisor.handle({ jsonrpc: "2.0", id: "model-1", sessionId: "session-a", result: {} })).toBe(true);
    expect(supervisor.handle({ jsonrpc: "2.0", id: "model-1", sessionId: "session-a", result: {} })).toBe(false);
    expect(emitted.map((value) => value.data.code)).toEqual(["UNKNOWN_RESPONSE", "RESPONSE_SESSION_MISMATCH", "DUPLICATE_RESPONSE"]);
  });

  it("fails every pending request exactly once and clears timers after a crash", () => {
    vi.useFakeTimers();
    const worker = transport();
    const emitted: any[] = [];
    let next = 0;
    const supervisor = new HarnessSupervisor(worker, (value) => emitted.push(value), { nextRequestId: () => `request-${++next}` });
    supervisor.requestModel("session-a", "a", 100);
    supervisor.requestModel("session-b", "b", 100);
    supervisor.crashed({ code: "WORKER_EXITED", message: "exit 7" });
    vi.advanceTimersByTime(200);
    expect(emitted).toHaveLength(2);
    expect(emitted.map((value) => value.requestId)).toEqual(["request-1", "request-2"]);
    expect(emitted.every((value) => value.data.code === "WORKER_EXITED")).toBe(true);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(() => supervisor.requestModel("session-a", "later")).toThrow("closed");
  });

  it("close is idempotent, fails pending requests, and rejects later sends", () => {
    vi.useFakeTimers();
    const worker = transport();
    const emitted: any[] = [];
    const supervisor = new HarnessSupervisor(worker, (value) => emitted.push(value), { nextRequestId: () => "request-1" });
    supervisor.requestModel("session-a", "hello", 100);
    supervisor.close();
    supervisor.close();
    vi.advanceTimersByTime(200);
    expect(worker.close).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data.code).toBe("WORKER_CLOSED");
    expect(() => supervisor.cancel("session-a")).toThrow("closed");
  });

  it("times out a request once and sends a cancellation", () => {
    vi.useFakeTimers();
    const worker = transport();
    const emitted: any[] = [];
    let next = 0;
    const supervisor = new HarnessSupervisor(worker, (value) => emitted.push(value), { nextRequestId: () => `request-${++next}` });
    supervisor.requestModel("session-a", "hello", 20);
    vi.advanceTimersByTime(21);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].data.code).toBe("TIMEOUT");
    expect(worker.send).toHaveBeenLastCalledWith(expect.objectContaining({ method: "cancel", sessionId: "session-a" }));
  });
});
