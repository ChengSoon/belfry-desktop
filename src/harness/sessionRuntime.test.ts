import { describe, expect, it, vi } from "vitest";
import { HarnessSessionRuntime } from "./sessionRuntime";

const plugin = { pluginId: "p", version: "1.0.0", manifestDigest: "d", harnessApi: 1, minAppVersion: "0.19.0", trusted: true, enabled: true, source: "x", tools: ["project.read"], capabilities: ["project.read"] };
const snapshot = { sessionId: "s", agentId: "a", plugin, workerId: "w", projectRoot: "/p", grants: ["project.read"], cancelled: false, resumable: true };
function setup(overrides: Record<string, unknown> = {}) {
  let message: (value: unknown) => void = () => {};
  let failure: (value: { code: string }) => void = () => {};
  const transport = { workerId: "w", send: vi.fn(), close: vi.fn() };
  const registry = { snapshot: vi.fn(async () => snapshot), authorize: vi.fn(async () => snapshot) };
  const broker = { register: vi.fn(async (_registration: Record<string, unknown>) => {}), updateGrants: vi.fn(async (_sessionId: string, _grants: string[]) => {}), cancel: vi.fn(async (_sessionId: string) => {}), route: vi.fn(async (_w, value: any) => value.params?.tool === "project.read") };
  const patch = { route: vi.fn(async (_w, value: any) => value.params?.tool?.startsWith("project.patch")) };
  const command = { route: vi.fn(async (_w, value: any) => value.params?.tool === "command.exec") };
  const deps = { registry, broker, patch, command, cancelCommand: vi.fn(async () => {}), startWorker: vi.fn(async (_sessionId, m, f) => { message = m; failure = f; return transport; }), ...overrides };
  const runtime = new HarnessSessionRuntime({ sessionId: "s", agentId: "a", pluginId: "p", projectRoot: "/p", grants: ["project.read"], workerId: "w" }, deps as any, vi.fn());
  return { runtime, deps, transport, message: (v: unknown) => message(v), failure: (v: any) => failure(v) };
}

describe("HarnessSessionRuntime", () => {
  it("starts in dependency order and sends initialize plus session start", async () => {
    const x = setup(); await x.runtime.start();
    expect(x.runtime.state).toBe("running");
    expect(x.deps.registry.snapshot).toHaveBeenCalledBefore(x.deps.registry.authorize);
    expect(x.deps.registry.authorize).toHaveBeenCalledBefore(x.deps.broker.register);
    expect(x.deps.broker.register).toHaveBeenCalledBefore(x.deps.broker.updateGrants);
    expect(x.transport.send.mock.calls.map(([v]) => v.method)).toEqual(["initialize", "session/start"]);
  });

  it.each(["snapshot", "authorize", "register"])("closes after %s startup failure", async (stage) => {
    const x = setup();
    if (stage === "register") x.deps.broker.register.mockRejectedValueOnce(new Error(stage));
    else if (stage === "snapshot") x.deps.registry.snapshot.mockRejectedValueOnce(new Error(stage));
    else x.deps.registry.authorize.mockRejectedValueOnce(new Error(stage));
    await expect(x.runtime.start()).rejects.toThrow(stage); expect(x.runtime.state).toBe("closed"); expect(x.transport.close).not.toHaveBeenCalled();
  });

  it("marks grant sync failure as reconcile-required and does not report success", async () => {
    const x = setup(); x.deps.broker.updateGrants.mockRejectedValueOnce(new Error("sync"));
    await expect(x.runtime.start()).rejects.toThrow("sync"); expect(x.runtime.state).toBe("reconcile-required"); expect(x.transport.close).not.toHaveBeenCalled();
  });

  it("routes all tool families and returns one error for duplicate unknown requests", async () => {
    const x = setup(); await x.runtime.start(); x.transport.send.mockClear();
    for (const tool of ["project.read", "project.patch.propose", "command.exec"]) await x.runtime.handle({ method: "tool/request", id: tool, sessionId: "s", params: { toolId: tool, tool } });
    const unknown = { method: "tool/request", id: "u", sessionId: "s", params: { toolId: "u", tool: "unknown" } };
    await x.runtime.handle(unknown); await x.runtime.handle(unknown);
    expect(x.deps.broker.route).toHaveBeenCalledTimes(4); expect(x.deps.patch.route).toHaveBeenCalledTimes(3); expect(x.deps.command.route).toHaveBeenCalledTimes(2);
    expect(x.transport.send).toHaveBeenCalledTimes(1); expect(x.transport.send.mock.calls[0][0].error.code).toBe("TOOL_UNDECLARED");
  });

  it("converges cancel, crash, and close races exactly once and rejects later work", async () => {
    const x = setup(); await x.runtime.start();
    await Promise.all([x.runtime.cancel(), x.runtime.crash({ code: "CRASH" }), x.runtime.close()]);
    expect(x.deps.broker.cancel).toHaveBeenCalledOnce(); expect(x.deps.cancelCommand).toHaveBeenCalledOnce(); expect(x.transport.close).toHaveBeenCalledOnce();
    expect(await x.runtime.handle({ method: "tool/request" })).toBe(false); await expect(x.runtime.authorize([])).rejects.toThrow("closed");
  });

  it("keeps two sessions isolated", async () => {
    const one = setup(); const two = setup({ registry: { snapshot: vi.fn(async () => ({ ...snapshot, sessionId: "s2" })), authorize: vi.fn(async () => ({ ...snapshot, sessionId: "s2" })) } });
    await one.runtime.start();
    const runtime2 = new HarnessSessionRuntime({ sessionId: "s2", agentId: "a", pluginId: "p", projectRoot: "/p", grants: [], workerId: "w" }, two.deps as any, vi.fn()); await runtime2.start();
    expect(one.deps.broker.register.mock.calls[0]?.[0].sessionId).toBe("s"); expect(two.deps.broker.register.mock.calls[0]?.[0].sessionId).toBe("s2");
  });
});
