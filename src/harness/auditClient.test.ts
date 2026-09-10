import { describe, expect, it, vi } from "vitest";
import { HarnessAuditClient, normalizeAudit } from "./auditClient";
describe("HarnessAuditClient", () => {
  it("queries bounded pages and preserves filters", async () => { const invoke = vi.fn(async () => ({ events: [{ id: "1", timestamp: 1, phase: "completed", sessionId: "s", requestId: "r", toolId: "t", durationMs: 2, summary: "ok", truncated: false }], total: 1, nextCursor: 1 })); const page = await new HarnessAuditClient({ invoke }).query({ sessionId: "s", limit: 10 }); expect(page.events).toHaveLength(1); expect(invoke).toHaveBeenCalledWith("harness_audit_query", { query: { sessionId: "s", limit: 10 } }); });
  it("rejects malformed or unsafe entries", () => { expect(normalizeAudit({ phase: "failed" })).toBeUndefined(); const event = normalizeAudit({ id: "1", timestamp: 1, phase: "future", sessionId: "s", requestId: "r", toolId: "t", durationMs: 0, summary: "x".repeat(600), truncated: true }); expect(event?.summary).toHaveLength(512); });
});
