import { describe, expect, it, vi } from "vitest";
import { CommandClient, normalizeCommandAudit } from "./commandClient";

const request = { jsonrpc: "2.0", id: "exec-1", method: "tool/request", sessionId: "s", params: { toolId: "t", tool: "command.exec", executable: "echo", argv: ["a b"] } };
describe("CommandClient", () => {
  it("completes request through approval and execution", async () => {
    const invoke = vi.fn(async (command: string) => ({ harness_command_request: { approvalId: "a", expiresAt: 2 }, harness_command_approve: "token", harness_command_execute: { exitCode: 0, stdout: "a b" } })[command]);
    const transport = { send: vi.fn(), close: vi.fn() };
    expect(await new CommandClient({ invoke }, async () => true).route("w", request, transport)).toBe(true);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["harness_command_request", "harness_command_approve", "harness_command_execute"]);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ id: "exec-1", result: expect.objectContaining({ stdout: "a b" }) }));
  });
  it("rejects once and returns a stable denial", async () => {
    const invoke = vi.fn(async (command: string) => command === "harness_command_request" ? { approvalId: "a", expiresAt: 2 } : undefined); const transport = { send: vi.fn(), close: vi.fn() };
    await new CommandClient({ invoke }, async () => false).route("w", request, transport);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: "APPROVAL_DENIED", message: "command approval denied" } }));
  });
  it("validates command audits", () => { expect(normalizeCommandAudit({ phase: "output", sessionId: "s", requestId: "r", toolId: "t", durationMs: 1, summary: "x", stream: "stdout" })).toBeTruthy(); expect(normalizeCommandAudit({ phase: "output", stream: "mixed" })).toBeUndefined(); });
});
