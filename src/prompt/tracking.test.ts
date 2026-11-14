import { describe, expect, it, vi } from "vitest";
import type { PromptDeliveryOptions, TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { PromptQueueRuntime } from "./runtime";
import type { PromptQueueUpdate } from "./contracts";
import { statusReport } from "../terminal/fixtures/programStatus";

const agent = { id: "reviewer", kind: "codex", project: { rootPath: "/work" }, phase: "running", activity: "idle", agentState: statusReport("codex", "idle") } as WorkspaceTab;
function fixture(kind: "codex" | "claude" = "codex") {
  const current = { ...agent, kind, agentState: statusReport(kind, "idle") } as WorkspaceTab;
  const runtime = new PromptQueueRuntime();
  const updates: PromptQueueUpdate[] = [];
  let delivery: PromptDeliveryOptions | undefined;
  const target: TerminalCommandTarget = { focus: vi.fn(), sendText: vi.fn((_text, options) => { delivery = options; return true; }) };
  const targets = new Map([[agent.id, target]]);
  const send = (tab = current) => runtime.submit([tab], targets, agent.id, "review feedback", {
    id: "feedback", projectRoot: "/work", onUpdate: (update) => updates.push(update),
  });
  return { runtime, updates, target, targets, send, current, result: (result: Parameters<NonNullable<PromptDeliveryOptions["onResult"]>>[0]) => delivery?.onResult?.(result) };
}

describe("tracked review delivery", () => {
  it.each(["codex", "claude"] as const)("keeps %s in-flight input until its native write result arrives, even if status changes first", (kind) => {
    for (const state of ["working", "blocked", "error", "clear", null] as const) {
      const test = fixture(kind);
      test.send();
      const changed = { ...test.current, agentState: state ? statusReport(kind, state, 2) : null };
      test.runtime.sync([changed], test.targets);
      test.result("not-written");
      expect(test.runtime.items.map((item) => item.id)).toEqual(["feedback"]);
      expect(test.updates.at(-1)?.state).toBe("queued");
      expect(test.target.sendText).toHaveBeenCalledOnce();
      test.runtime.sync([{ ...test.current, agentState: statusReport(kind, "idle", 3) }], test.targets);
      expect(test.target.sendText).toHaveBeenCalledTimes(2);
    }
  });

  it.each(["codex", "claude"] as const)("does not clear an uncertain %s paste just because an unrelated working report arrives", (kind) => {
    const test = fixture(kind);
    test.target.composerEmpty = () => false;
    test.send(); test.result("cancelled");
    test.runtime.sync([{ ...test.current, agentState: statusReport(kind, "working", 2) }], test.targets);
    test.runtime.sync([{ ...test.current, agentState: statusReport(kind, "done", 3) }], test.targets);
    expect(test.runtime.pausedDeliveries()).toHaveLength(1);
    expect(test.target.sendText).toHaveBeenCalledOnce();
  });

  it("does not report submitted until the terminal confirms Enter was written", () => {
    const test = fixture();
    expect(test.send()).toBe("sent");
    expect(test.updates.map((item) => item.state)).toEqual(["queued", "sending"]);
    expect(test.runtime.cancel("feedback")).toBe(false);
    test.result("submitted");
    expect(test.updates.at(-1)?.state).toBe("submitted");
    expect(test.target.focus).not.toHaveBeenCalled();
  });

  it("cancels queued feedback without injecting it into an approval prompt or resending on idle", () => {
    const test = fixture();
    const waiting = { ...agent, activity: "awaiting-choice", agentState: statusReport("codex", "blocked", 2) } as WorkspaceTab;
    expect(test.send(waiting)).toBe("queued");
    test.runtime.sync([waiting], test.targets);
    expect(test.target.sendText).not.toHaveBeenCalled();
    expect(test.runtime.cancel("feedback")).toBe(true);
    test.runtime.sync([agent], test.targets);
    expect(test.target.sendText).not.toHaveBeenCalled();
    expect(test.updates.at(-1)?.state).toBe("cancelled");
  });

  it("rechecks the project at dispatch and cancels when a queued recipient changes directories", () => {
    const test = fixture();
    test.send({ ...agent, activity: "talking", agentState: statusReport("codex", "working", 2) });
    const moved = { ...agent, project: { ...agent.project, rootPath: "/different-worktree" } };
    test.runtime.sync([moved], test.targets);
    expect(test.target.sendText).not.toHaveBeenCalled();
    expect(test.updates.at(-1)?.state).toBe("cancelled");
    expect(test.runtime.items).toEqual([]);
    expect(test.send(moved)).toBe("unavailable");
  });

  it("distinguishes an exited queued recipient from uncertain delivery after writing began", () => {
    const queued = fixture();
    queued.send({ ...agent, activity: "talking", agentState: statusReport("codex", "working", 2) });
    queued.runtime.sync([{ ...agent, phase: "exited" }], queued.targets);
    expect(queued.updates.at(-1)?.state).toBe("cancelled");
    const writing = fixture();
    writing.send(); writing.runtime.sync([], writing.targets);
    expect(writing.updates.at(-1)?.state).toBe("attention");
  });

  it("reports ambiguous failures without retrying partial input, while definitely unwritten input can retry", () => {
    const failed = fixture();
    failed.send(); failed.result("failed"); failed.runtime.sync([agent], failed.targets);
    expect(failed.updates.at(-1)?.state).toBe("attention");
    expect(failed.target.sendText).toHaveBeenCalledOnce();
    const unwritten = fixture();
    unwritten.send(); unwritten.result("not-written");
    expect(unwritten.updates.at(-1)?.state).toBe("queued");
    unwritten.runtime.sync([agent], unwritten.targets); unwritten.result("submitted");
    expect(unwritten.updates.at(-1)?.state).toBe("submitted");
  });
});
