import { describe, expect, it, vi } from "vitest";
import { TauriWorkerTransport, type WorkerEnvelope } from "./tauriTransport";

function bridge() {
  let handler: ((event: { payload: WorkerEnvelope }) => void) | undefined;
  const unlisten = vi.fn();
  const invoke = vi.fn(async (command: string) => command === "harness_worker_start" ? "worker-1" : undefined);
  const listen = vi.fn(async (_event: string, next: typeof handler) => { handler = next; return unlisten; });
  return { api: { invoke, listen }, emit: (payload: WorkerEnvelope) => handler?.({ payload }), invoke, unlisten };
}

describe("TauriWorkerTransport", () => {
  it("starts before sending and filters the shared event channel by worker ID", async () => {
    const fake = bridge();
    const messages: unknown[] = [];
    const transport = await TauriWorkerTransport.start("node", ["worker.mjs"], messages.push.bind(messages), vi.fn(), fake.api);
    fake.emit({ workerId: "other", kind: "message", message: "ignored" });
    fake.emit({ workerId: "worker-1", kind: "message", message: { ok: true } });
    transport.send({ jsonrpc: "2.0", id: "one", method: "initialize" });
    expect(messages).toEqual([{ ok: true }]);
    expect(fake.invoke).toHaveBeenLastCalledWith("harness_worker_send", { workerId: "worker-1", request: expect.objectContaining({ id: "one" }) });
  });

  it("maps terminal lifecycle failures and closes idempotently", async () => {
    const fake = bridge();
    const failed = vi.fn();
    const transport = await TauriWorkerTransport.start("node", ["worker.mjs"], vi.fn(), failed, fake.api);
    fake.emit({ workerId: "worker-1", kind: "lifecycle", lifecycle: "protocol-failed", detail: "bad JSON" });
    transport.close();
    transport.close();
    expect(failed).toHaveBeenCalledWith({ code: "WORKER_PROTOCOL_FAILED", message: "bad JSON" });
    expect(fake.unlisten).toHaveBeenCalledTimes(1);
    expect(fake.invoke.mock.calls.filter(([command]) => command === "harness_worker_stop")).toHaveLength(1);
    expect(() => transport.send({ jsonrpc: "2.0", id: "two", method: "initialize" })).toThrow("closed");
  });

  it("starts a registered worker using only the session ID", async () => {
    const fake = bridge();
    fake.invoke.mockImplementation(async (command: string) => command === "harness_session_worker_start" ? "worker-1" : undefined);
    const transport = await TauriWorkerTransport.startSession("session-1", vi.fn(), vi.fn(), fake.api);
    expect(transport.workerId).toBe("worker-1");
    expect(fake.invoke).toHaveBeenCalledWith("harness_session_worker_start", { sessionId: "session-1" });
  });
});
