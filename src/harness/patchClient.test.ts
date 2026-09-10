import { describe, expect, it, vi } from "vitest";
import { PatchClient } from "./patchClient";

const preview = { previewId: "p", generation: 1, relativePath: "a.txt", originalDigest: "old", replacementDigest: "new", oldLines: 1, newLines: 1, finalBytes: 3, diff: { hunks: [{ oldStart: 1, newStart: 1, lines: [{ kind: "delete", oldLine: 1, newLine: null, content: "old" }, { kind: "add", oldLine: null, newLine: 1, content: "new" }] }], truncated: false, omittedHunks: 0, omittedLines: 0, previewBytes: 6 }, expiresAt: 99 } as const;
const propose = { jsonrpc: "2.0", id: "r1", method: "tool/request", sessionId: "s", params: { toolId: "t1", tool: "project.patch.propose", relativePath: "a.txt", expectedDigest: "old", replacement: "new" } } as const;
const apply = { jsonrpc: "2.0", id: "r2", method: "tool/request", sessionId: "s", params: { toolId: "t2", tool: "project.patch.apply", previewId: "p", approvalToken: "token" } } as const;
const transport = () => ({ send: vi.fn(), close: vi.fn() });

describe("PatchClient", () => {
  it("proposes, approves, and returns the preview plus token envelope", async () => {
    const invoke = vi.fn(async (command: string) => command === "harness_patch_propose" ? preview : "token");
    const worker = transport();
    await new PatchClient({ invoke }, async () => true).route("w", propose, worker);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["harness_patch_propose", "harness_patch_approve"]);
    expect(worker.send).toHaveBeenCalledWith({ jsonrpc: "2.0", id: "r1", sessionId: "s", result: { ...preview, approvalToken: "token" } });
  });

  it("rejects the preview and returns one stable denial", async () => {
    const invoke = vi.fn(async (command: string) => command === "harness_patch_propose" ? preview : undefined);
    const worker = transport(); const client = new PatchClient({ invoke }, async () => false);
    await client.route("w", propose, worker); await client.route("w", propose, worker);
    expect(invoke.mock.calls.map(([name]) => name)).toEqual(["harness_patch_propose", "harness_patch_reject"]);
    expect(worker.send).toHaveBeenCalledTimes(1);
    expect(worker.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: "APPROVAL_DENIED", message: "patch approval denied" } }));
  });

  it.each(["APPROVAL_DENIED", "PREVIEW_EXPIRED", "WRITE_CONFLICT", "SESSION_CANCELLED", "CAPABILITY_DENIED"])("maps %s without leaking host diagnostics", async (code) => {
    const invoke = vi.fn(async () => { throw { code, message: "/secret/project/details" }; });
    const worker = transport(); await new PatchClient({ invoke }, async () => true).route("w", apply, worker);
    expect(worker.send.mock.calls[0][0].error.code).toBe(code);
    expect(worker.send.mock.calls[0][0].error.message).not.toContain("secret");
  });

  it("applies the worker-provided approved preview contract", async () => {
    const invoke = vi.fn(async () => null); const worker = transport();
    await new PatchClient({ invoke }, async () => true).route("w", apply, worker);
    expect(invoke).toHaveBeenCalledWith("harness_patch_apply", { request: { sessionId: "s", workerId: "w", requestId: "r2", toolId: "t2", previewId: "p", approvalToken: "token" } });
    expect(worker.send).toHaveBeenCalledWith({ jsonrpc: "2.0", id: "r2", sessionId: "s", result: null });
  });

  it("rejects malformed IPC previews and unrelated envelopes", async () => {
    const worker = transport(); const client = new PatchClient({ invoke: vi.fn(async () => ({ previewId: "p" })) }, async () => true);
    expect(await client.route("w", { event: {} }, worker)).toBe(false);
    await client.route("w", propose, worker);
    expect(worker.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: "PATCH_FAILED", message: "patch request failed" } }));
  });

  it("rejects worker-shaped or malformed diff data from IPC", async () => {
    const worker = transport();
    const forged = { ...preview, diff: { ...preview.diff, hunks: [{ oldStart: 1, newStart: 1, lines: [{ kind: "html", content: "<img onerror=alert(1)>" }] }] } };
    await new PatchClient({ invoke: vi.fn(async () => forged) }, async () => true).route("w", propose, worker);
    expect(worker.send).toHaveBeenCalledWith(expect.objectContaining({ error: { code: "PATCH_FAILED", message: "patch request failed" } }));
  });
});
