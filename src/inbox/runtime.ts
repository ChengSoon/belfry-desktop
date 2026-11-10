import type {
  BatchView, BeginResult, Binding, BindRequest, Offer, OfferRequest, PendingView, PrepareRequest, PrepareResult,
  ReceiptRequest, WriteGuard,
} from "./contracts";
import { batchRequest } from "./contracts";

/**
 * 协作收件箱的输入运行时。每个接收会话只有一个“有待收件”标志，
 * 只有真实输入位置就绪时才 offer → prepare → begin → 一次写入 → 回执。
 *
 * 与旧 DeliveryCoordinator 的区别：
 * - 不为每条消息提前 claim，也不把内容排进 PromptQueue 等待；冻结点在后台 prepare。
 * - begin 之前任何就绪条件变化（用户输入、选择框、target 换代）都中止并 abort，内容回到 pending。
 * - begin 之后的写入由原生 guard 绑定本批；结果不明一律 uncertain，绝不重贴。
 */

/** 本地读到的输入位置事实。全部来自真实 target，不使用名册 idle 代替。 */
export interface InputSlot {
  tabId: string;
  terminalSessionId: string;
  running: boolean;
  idle: boolean;
  composerEmpty: boolean;
  awaitingInput: boolean;
  /** 旧 PromptQueue（宿主反馈等）对这个会话没有排队或在途的内容。 */
  promptQueueEmpty: boolean;
  /** 本地输入代次：用户每次输入都会推进。用来发现异步间隙中的抢先输入。 */
  inputRevision: number;
}

export type GuardedResult = "submitted" | "not-written" | "uncertain";

export interface InboxRuntimePorts {
  pending: () => Promise<PendingView>;
  bind: (request: BindRequest) => Promise<Binding>;
  offer: (request: OfferRequest) => Promise<Offer>;
  revoke: (offer: Offer) => Promise<void>;
  prepare: (request: PrepareRequest) => Promise<PrepareResult>;
  begin: (batch: BatchView, offer: Offer) => Promise<BeginResult>;
  receipt: (request: ReceiptRequest) => Promise<unknown>;
  abort: (batch: BatchView) => Promise<unknown>;
  /** 读取目标会话当前输入位置；没有活 target 返回 null。 */
  slot: (tabId: string) => InputSlot | null;
  /** 在已保留的输入位置一次写入 payload；所有程序化写入携带 guard。只能被调用一次。 */
  write: (tabId: string, payload: string, guard: WriteGuard, expectedInputRevision: number) => Promise<GuardedResult>;
  newId: () => string;
}

interface Bound { binding: Binding; terminalSessionId: string }
interface Receipt { request: ReceiptRequest; tabId: string }

export class InboxRuntime {
  readonly ownerId: string;
  private bound = new Map<string, Bound>();
  /** 每个会话最多一个在途尝试；在途期间不再 offer。 */
  private busy = new Set<string>();
  /** 回执失败只重试原回执，不重新写入。 */
  private receipts: Receipt[] = [];
  /**
   * 本地刚出现 uncertain、回执还没送达后台的会话。回执送达后由后台的 deliveryGate 接管阻塞
   * （跨房间、跨窗口都生效），本地标记随即解除；核对在后台/Agent 侧完成，界面不提供按钮。
   */
  private blocked = new Set<string>();
  private stopped = false;

  constructor(private readonly ports: InboxRuntimePorts) {
    this.ownerId = ports.newId();
  }

  stop() { this.stopped = true; }


  /** 一次调度：先补交回执，再为每个有待收件的会话尝试一次。返回本轮写入的批数。 */
  async tick(): Promise<number> {
    if (this.stopped) return 0;
    await this.flushReceipts();
    const view = await this.ports.pending();
    let written = 0;
    for (const recipient of view.recipients) {
      if (this.stopped) break;
      if (recipient.pendingCount <= 0 || this.busy.has(recipient.tabId) || this.blocked.has(recipient.tabId)) continue;
      this.busy.add(recipient.tabId);
      try {
        if (await this.attempt(recipient.sessionKey, recipient.tabId)) written += 1;
      } finally {
        this.busy.delete(recipient.tabId);
      }
    }
    await this.flushReceipts();
    return written;
  }

  private ready(slot: InputSlot | null): slot is InputSlot {
    return !!slot && slot.running && slot.idle && slot.composerEmpty && !slot.awaitingInput && slot.promptQueueEmpty;
  }

  /** 在原地复查：会话没换、输入没被抢、仍然就绪。 */
  private stillReady(tabId: string, before: InputSlot) {
    const now = this.ports.slot(tabId);
    return this.ready(now) && now.terminalSessionId === before.terminalSessionId && now.inputRevision === before.inputRevision;
  }

  private async binding(slot: InputSlot): Promise<Binding> {
    const known = this.bound.get(slot.tabId);
    if (known && known.terminalSessionId === slot.terminalSessionId) return known.binding;
    const binding = await this.ports.bind({ tabId: slot.tabId, terminalSessionId: slot.terminalSessionId, ownerId: this.ownerId });
    this.bound.set(slot.tabId, { binding, terminalSessionId: slot.terminalSessionId });
    return binding;
  }

  private async attempt(sessionKey: string, tabId: string): Promise<boolean> {
    const slot = this.ports.slot(tabId);
    if (!this.ready(slot)) return false;

    let binding: Binding;
    try { binding = await this.binding(slot); } catch { return false; }

    let offer: Offer;
    try {
      offer = await this.ports.offer({
        binding, offerId: this.ports.newId(), running: slot.running, idle: slot.idle,
        composerEmpty: slot.composerEmpty, awaitingInput: slot.awaitingInput, promptQueueEmpty: slot.promptQueueEmpty,
      });
    } catch {
      // 原生输入代次已变或绑定失效：下次重新绑定。
      this.bound.delete(tabId);
      return false;
    }
    if (!this.stillReady(tabId, slot)) { await this.quietly(() => this.ports.revoke(offer)); return false; }

    let prepared: PrepareResult;
    try {
      prepared = await this.ports.prepare({ sessionKey, offer, operationId: this.ports.newId() });
    } catch {
      await this.quietly(() => this.ports.revoke(offer));
      return false;
    }
    const batch = prepared.batch;
    if (!batch) { await this.quietly(() => this.ports.revoke(offer)); return false; }

    // 冻结后、提交意图前：输入位置一旦变化，安全退回 pending。
    if (this.stopped || !this.stillReady(tabId, slot)) {
      await this.quietly(() => this.ports.abort(batch));
      await this.quietly(() => this.ports.revoke(offer));
      return false;
    }

    let begun: BeginResult;
    try {
      begun = await this.ports.begin(batch, offer);
    } catch {
      // begin 结果未知：不能当作未开始，也不能重发本批。后台若已落意图，会按恢复规则转 uncertain 并阻塞该会话；
      // 若从未落盘，原项仍是 pending，下次需要新的输入机会和新的 prepare。
      return false;
    }

    // 已有提交意图。最后一次复查：被抢先就不写，回执 uncertain，不能把这批再排队。
    if (this.stopped || !this.stillReady(tabId, slot)) {
      this.queueReceipt(begun.batch, "uncertain", "input changed after submit intent");
      return false;
    }

    let result: GuardedResult;
    try { result = await this.ports.write(tabId, begun.batch.payload, begun.writeGuard, slot.inputRevision); }
    catch { result = "uncertain"; }

    if (result === "submitted") {
      this.queueReceipt(begun.batch, "submitted", null);
      return true;
    }
    // not-written 在 begin 之后也只能算不确定：意图已落盘，不能退回 pending 重投。
    this.queueReceipt(begun.batch, "uncertain", result === "not-written" ? "write not accepted after submit intent" : null);
    return false;
  }

  private queueReceipt(batch: BatchView, phase: "submitted" | "uncertain", message: string | null) {
    if (phase === "uncertain") this.blocked.add(batch.recipient.tabId);
    this.receipts.push({
      request: { batchId: batch.id, attemptId: batch.attemptId, sequence: batch.sequence + 1, phase, payloadHash: batch.payloadHash, message },
      tabId: batch.recipient.tabId,
    });
  }

  private async flushReceipts() {
    const remaining: Receipt[] = [];
    for (const receipt of this.receipts) {
      try { await this.ports.receipt(receipt.request); }
      catch { remaining.push(receipt); }
    }
    this.receipts = remaining;
    for (const tabId of [...this.blocked]) {
      if (!remaining.some((item) => item.tabId === tabId)) this.blocked.delete(tabId);
    }
  }

  /** 未送出的回执数（测试与诊断用）。 */
  get pendingReceipts() { return this.receipts.map((item) => item.request); }

  private async quietly(action: () => Promise<unknown>) { try { await action(); } catch { /* 后台按租约兜底。 */ } }

  /** 供测试：当前哪些会话因不确定被阻塞。 */
  get blockedTabs(): readonly string[] { return [...this.blocked]; }

  /** 供上层：最近一次 batch 的请求参数（核对时用）。 */
  static request(batch: BatchView) { return batchRequest(batch); }
}
