import { describe, expect, it, vi } from "vitest";
import type { BatchView, BeginResult, Binding, Offer, PendingView, PrepareResult, ReceiptRequest } from "./contracts";
import { InboxRuntime, type GuardedResult, type InboxRuntimePorts, type InputSlot } from "./runtime";

const slot = (over: Partial<InputSlot> = {}): InputSlot => ({
  tabId: "tab-b", terminalSessionId: "pty-1", running: true, idle: true, composerEmpty: true,
  awaitingInput: false, promptQueueEmpty: true, inputRevision: 3, ...over,
});
const batch = (over: Partial<BatchView> = {}): BatchView => ({
  id: "batch-1", attemptId: "att-1", revision: 1, sequence: 1,
  recipient: { id: "r", sessionKey: "sk-b", projectRoot: "/p", tabId: "tab-b", roomId: null, memberId: null, name: "后端", agent: "codex" },
  targetEpoch: "e1", terminalSessionId: "pty-1", topicId: "t", entryIds: ["e1", "e2"], messageIds: ["m1", "m2"],
  payload: "[Belfry 收件箱] 2 条", payloadHash: "h", contentMode: "full", phase: "prepared", preparedAt: 0, leaseExpiresAt: 0, ...over,
});

interface Harness { ports: InboxRuntimePorts; calls: string[]; receipts: ReceiptRequest[]; writes: { payload: string; token: string }[]; state: { slot: InputSlot | null } }

function harness(over: Partial<InboxRuntimePorts> = {}, pending: PendingView = { revision: 1, recipients: [{ sessionKey: "sk-b", tabId: "tab-b", projectRoot: "/p", pendingCount: 4 }] }): Harness {
  const calls: string[] = [], receipts: ReceiptRequest[] = [], writes: { payload: string; token: string }[] = [];
  const state = { slot: slot() as InputSlot | null };
  let n = 0;
  const binding: Binding = { tabId: "tab-b", terminalSessionId: "pty-1", ownerId: "owner", targetEpoch: "e1", inputRevision: 3 };
  const offer: Offer = { binding, offerId: "offer", expiresAt: 0 };
  const ports: InboxRuntimePorts = {
    newId: () => `id-${++n}`,
    pending: async () => { calls.push("pending"); return pending; },
    slot: () => state.slot,
    bind: async () => { calls.push("bind"); return binding; },
    offer: async () => { calls.push("offer"); return offer; },
    revoke: async () => { calls.push("revoke"); },
    prepare: async (): Promise<PrepareResult> => { calls.push("prepare"); return { batch: batch(), blocker: null }; },
    begin: async (b): Promise<BeginResult> => { calls.push("begin"); return { batch: { ...b, sequence: 2, phase: "submitting" }, writeGuard: { batchId: b.id, attemptId: b.attemptId, token: "tok", ownerId: "owner", targetEpoch: "e1", inputRevision: 3 } }; },
    receipt: async (r) => { calls.push(`receipt:${r.phase}`); receipts.push(r); return null; },
    abort: async () => { calls.push("abort"); return null; },
    write: async (_tab, payload, guard): Promise<GuardedResult> => { calls.push("write"); writes.push({ payload, token: guard.token }); return "submitted"; },
    ...over,
  };
  return { ports, calls, receipts, writes, state };
}

describe("InboxRuntime", () => {
  it("忙时多条来信只形成一个提醒，就绪后整批一次写入并回执 submitted", async () => {
    const h = harness();
    const rt = new InboxRuntime(h.ports);
    expect(await rt.tick()).toBe(1);
    expect(h.calls).toEqual(["pending", "bind", "offer", "prepare", "begin", "write", "receipt:submitted"]);
    expect(h.writes).toEqual([{ payload: "[Belfry 收件箱] 2 条", token: "tok" }]);
    // receipt.sequence = begin 返回的 batch.sequence + 1
    expect(h.receipts[0]).toMatchObject({ batchId: "batch-1", attemptId: "att-1", sequence: 3, phase: "submitted", payloadHash: "h" });
  });

  it.each([
    ["忙碌", { idle: false }], ["输入区非空", { composerEmpty: false }], ["等待选择/权限", { awaitingInput: true }],
    ["旧队列仍有内容", { promptQueueEmpty: false }], ["未运行", { running: false }],
  ])("%s 时不 offer、不 prepare（名册 idle 不能代替真实输入位置）", async (_name, over) => {
    const h = harness();
    h.state.slot = slot(over as Partial<InputSlot>);
    await new InboxRuntime(h.ports).tick();
    expect(h.calls).toEqual(["pending"]);
  });

  it("没有活 target 时不投递", async () => {
    const h = harness();
    h.state.slot = null;
    await new InboxRuntime(h.ports).tick();
    expect(h.calls).toEqual(["pending"]);
  });

  it("prepare 之后、begin 之前用户抢先输入：abort 退回 pending 并撤销 offer，绝不写入", async () => {
    const h = harness({
      prepare: async () => { h.state.slot = slot({ inputRevision: 4 }); return { batch: batch(), blocker: null }; },
    });
    expect(await new InboxRuntime(h.ports).tick()).toBe(0);
    expect(h.calls).toContain("abort");
    expect(h.calls).toContain("revoke");
    expect(h.calls).not.toContain("begin");
    expect(h.writes).toEqual([]);
  });

  it("begin 之后输入位置变化：不写入，回执 uncertain，并阻塞该会话后续自动投递", async () => {
    const h = harness();
    h.ports.begin = async (b) => {
      h.state.slot = slot({ composerEmpty: false });
      return { batch: { ...b, sequence: 2 }, writeGuard: { batchId: b.id, attemptId: b.attemptId, token: "tok", ownerId: "o", targetEpoch: "e1", inputRevision: 3 } };
    };
    const rt = new InboxRuntime(h.ports);
    await rt.tick();
    expect(h.writes).toEqual([]);
    expect(h.receipts.map((r) => r.phase)).toEqual(["uncertain"]);
    expect(rt.blockedTabs).toEqual(["tab-b"]);
    h.state.slot = slot();
    h.calls.length = 0;
    await rt.tick();
    expect(h.calls).toEqual(["pending"]); // 不确定未核对前不再自动投递
  });

  it("begin 结果未知（请求失败）：不写入、不重发，阻塞该会话", async () => {
    const h = harness();
    h.ports.begin = async () => { h.calls.push("begin"); throw new Error("lost"); };
    const rt = new InboxRuntime(h.ports);
    await rt.tick();
    await rt.tick();
    expect(h.writes).toEqual([]);
    expect(h.calls.filter((c) => c === "begin")).toHaveLength(1);
    expect(rt.blockedTabs).toEqual(["tab-b"]);
  });

  it("写入后未确认（detached/失败）只回执 uncertain，不会第二次写入", async () => {
    const h = harness();
    h.ports.write = async () => { h.calls.push("write"); return "uncertain"; };
    const rt = new InboxRuntime(h.ports);
    await rt.tick(); await rt.tick();
    expect(h.receipts.map((r) => r.phase)).toEqual(["uncertain"]);
    expect(h.calls.filter((c) => c === "write")).toHaveLength(1);
  });

  it("begin 之后 sendText 被拒（not-written）也按 uncertain 处理，意图已落盘不能退回重投", async () => {
    const h = harness({ write: async () => "not-written" });
    const rt = new InboxRuntime(h.ports);
    await rt.tick();
    expect(h.receipts.map((r) => r.phase)).toEqual(["uncertain"]);
    expect(h.calls).not.toContain("abort");
  });

  it("回执失败只重试原回执（同 sequence/phase/hash），不重新写入", async () => {
    let fail = true;
    const h = harness();
    h.ports.receipt = async (r) => { h.calls.push(`receipt:${r.phase}`); if (fail) throw new Error("ipc"); h.receipts.push(r); return null; };
    const rt = new InboxRuntime(h.ports);
    await rt.tick();
    expect(rt.pendingReceipts).toHaveLength(1);
    fail = false;
    h.ports.pending = async () => ({ revision: 2, recipients: [] });
    await rt.tick();
    expect(h.receipts).toEqual([expect.objectContaining({ sequence: 3, phase: "submitted", payloadHash: "h" })]);
    expect(h.calls.filter((c) => c === "write")).toHaveLength(1);
  });

  it("后台返回 blocker（例如等待上一任务交差）时不写入，并撤销 offer", async () => {
    const h = harness();
    h.ports.prepare = async () => { h.calls.push("prepare"); return { batch: null, blocker: { code: "previous_task", params: { task: "T60" } } }; };
    await new InboxRuntime(h.ports).tick();
    expect(h.calls).toEqual(["pending", "bind", "offer", "prepare", "revoke"]);
  });

  it("offer 被拒（原生输入代次已变）时丢弃绑定，下次重新 bind", async () => {
    let first = true;
    const h = harness({ offer: async () => { h.calls.push("offer"); if (first) { first = false; throw new Error("stale"); } return { binding: { tabId: "tab-b", terminalSessionId: "pty-1", ownerId: "o", targetEpoch: "e2", inputRevision: 4 }, offerId: "x", expiresAt: 0 }; } });
    const rt = new InboxRuntime(h.ports);
    await rt.tick(); await rt.tick();
    expect(h.calls.filter((c) => c === "bind")).toHaveLength(2);
  });

  it("终端换代（新 PTY）重新绑定，同一 PTY 复用绑定", async () => {
    const h = harness();
    const rt = new InboxRuntime(h.ports);
    await rt.tick(); await rt.tick();
    expect(h.calls.filter((c) => c === "bind")).toHaveLength(1);
    h.state.slot = slot({ terminalSessionId: "pty-2" });
    await rt.tick();
    expect(h.calls.filter((c) => c === "bind")).toHaveLength(2);
  });

  it("同一会话不会并发两批：上一轮未结束时下一轮跳过", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness({ prepare: async () => { h.calls.push("prepare"); await gate; return { batch: batch(), blocker: null }; } });
    const rt = new InboxRuntime(h.ports);
    const first = rt.tick();
    await vi.waitFor(() => expect(h.calls).toContain("prepare"));
    await rt.tick();
    release();
    await first;
    expect(h.calls.filter((c) => c === "prepare")).toHaveLength(1);
    expect(h.writes).toHaveLength(1);
  });

  it("运行时停止后（卸载）在 begin 前中止，不写入", async () => {
    const h = harness();
    const rt = new InboxRuntime(h.ports);
    h.ports.prepare = async () => { rt.stop(); return { batch: batch(), blocker: null }; };
    await rt.tick();
    expect(h.calls).toContain("abort");
    expect(h.writes).toEqual([]);
  });

  it("人工核对后 unblock，需要新的输入机会才继续", async () => {
    const h = harness({ write: async () => "uncertain" });
    const rt = new InboxRuntime(h.ports);
    await rt.tick();
    expect(rt.blockedTabs).toEqual(["tab-b"]);
    rt.unblock("tab-b");
    h.ports.write = async (_t, payload, guard) => { h.writes.push({ payload, token: guard.token }); return "submitted"; };
    await rt.tick();
    expect(h.writes).toHaveLength(1);
  });

  it("pendingCount 为 0 的会话不触发任何投递调用", async () => {
    const h = harness({}, { revision: 1, recipients: [{ sessionKey: "sk", tabId: "tab-b", projectRoot: "/p", pendingCount: 0 }] });
    await new InboxRuntime(h.ports).tick();
    expect(h.calls).toEqual(["pending"]);
  });
});
