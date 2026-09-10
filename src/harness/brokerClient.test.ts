import { describe, expect, it, vi } from "vitest";
import { BrokerClient, normalizeAudit } from "./brokerClient";

describe("BrokerClient", () => {
  it("routes worker tool requests through the host broker", async () => {
    const bridge = { invoke: vi.fn(async () => ({ content: "hello" })) };
    const transport = { send: vi.fn(), close: vi.fn() };
    const handled = await new BrokerClient(bridge).route("worker", { jsonrpc: "2.0", id: "request", method: "tool/request", sessionId: "session", params: { toolId: "tool", tool: "project.read", path: "hello.txt" } }, transport);
    expect(handled).toBe(true);
    expect(bridge.invoke).toHaveBeenCalledWith("harness_broker_handle", expect.objectContaining({ workerId: "worker" }));
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ id: "request", result: { content: "hello" } }));
  });

  it("returns stable errors and ignores unrelated messages", async () => {
    const bridge = { invoke: vi.fn(async () => { throw { code: "CAPABILITY_DENIED", message: "denied" }; }) };
    const transport = { send: vi.fn(), close: vi.fn() };
    const client = new BrokerClient(bridge);
    expect(await client.route("worker", { event: {} }, transport)).toBe(false);
    await client.route("worker", { jsonrpc: "2.0", id: "r", method: "tool/request", sessionId: "s", params: { toolId: "t", tool: "project.list" } }, transport);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: "CAPABILITY_DENIED", message: "denied" } }));
  });

  it("normalizes only complete audit events", () => {
    expect(normalizeAudit({ phase: "completed", sessionId: "s", requestId: "r", toolId: "t", tool: "project.read", durationMs: 2, summary: "done" })).toBeTruthy();
    expect(normalizeAudit({ phase: "completed", sessionId: "s" })).toBeUndefined();
  });
});
