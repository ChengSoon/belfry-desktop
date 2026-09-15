import type { OutputReceipt, TerminalEvent, TerminalSession, TerminalStreamEvent } from "../contracts";
import { acceptSequence } from "../sequence";

export const OUTPUT_WINDOW_BYTES = 256 * 1024;
const MAX_BATCHES = 4;
const MAX_BATCH_EVENTS = 256;
const MAX_PENDING_EVENTS = MAX_BATCHES * MAX_BATCH_EVENTS;
const OUTPUT_EVENT_OVERHEAD = 128;
const CONTROL_EVENT_OVERHEAD = 256;
const STREAM_KINDS = new Set(["output", "exit", "replay_gap", "agent_state", "disconnected"]);

interface OutputQueuePorts {
  render: (events: TerminalStreamEvent[]) => Promise<void>;
  acknowledge: (receipt: OutputReceipt) => Promise<boolean>;
  fail: (error: unknown) => void;
}

interface PendingOutput {
  events: TerminalStreamEvent[];
  receipt?: OutputReceipt;
  bytes: number;
}

/** 原始数据留在有界队列里，每次只让一批进入 xterm；解析完成才发 ACK。 */
export class OutputQueue {
  private pending: PendingOutput[] = [];
  private bytes = 0;
  private events = 0;
  private batches = 0;
  private busy = false;
  private disposed = false;
  private sessionId: string | null = null;
  private connectionId: string | null = null;
  private nextDelivery = 1;
  private expectedSequence = 0;
  private stop!: () => void;
  private readonly stopped = new Promise<void>((resolve) => { this.stop = resolve; });

  constructor(private readonly ports: OutputQueuePorts) {}

  bind(session: Pick<TerminalSession, "id" | "connectionId">) {
    if (this.disposed) return;
    try { this.checkIdentity(session.id, session.connectionId); }
    catch (error) { this.fail(error); }
  }

  push(event: TerminalEvent) {
    if (this.disposed) return;
    try {
      const item = this.prepare(event);
      if (this.bytes + item.bytes > OUTPUT_WINDOW_BYTES
        || this.events + item.events.length > MAX_PENDING_EVENTS
        || (item.receipt && this.batches >= MAX_BATCHES)) {
        throw new Error("终端待消费输出超出预算。可重新连接；原任务仍在后台运行。");
      }
      this.pending.push(item);
      this.bytes += item.bytes;
      this.events += item.events.length;
      if (item.receipt) this.batches += 1;
      void this.pump();
    } catch (error) { this.fail(error); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    this.bytes = this.events = this.batches = 0;
    this.stop();
  }

  private prepare(event: TerminalEvent): PendingOutput {
    if (event.kind !== "output_batch") {
      this.checkIdentity(event.sessionId);
      this.validateSequences([event]);
      return { events: [event], bytes: eventBytes(event) };
    }
    this.checkIdentity(event.sessionId, event.connectionId);
    if (event.deliveryId !== this.nextDelivery || !Number.isSafeInteger(event.deliveryId)) {
      throw new Error("终端输出批次顺序不匹配，请重新连接。");
    }
    if (event.events.length > MAX_BATCH_EVENTS
      || event.events.some((item) => item.sessionId !== event.sessionId || !STREAM_KINDS.has(item.kind))) {
      throw new Error("终端输出批次的会话或大小不匹配，请重新连接。");
    }
    this.nextDelivery += 1;
    this.validateSequences(event.events);
    const receipt = { sessionId: event.sessionId, connectionId: event.connectionId, deliveryId: event.deliveryId };
    return { events: event.events, receipt, bytes: event.events.reduce((sum, item) => sum + eventBytes(item), 0) };
  }

  private checkIdentity(session: string, connection?: string | null) {
    if ((this.sessionId && this.sessionId !== session)
      || (connection && this.connectionId && this.connectionId !== connection)) {
      throw new Error("终端输出连接已变更，请重新连接。");
    }
    this.sessionId = session;
    if (connection) this.connectionId = connection;
  }

  private validateSequences(events: TerminalStreamEvent[]) {
    let next = this.expectedSequence;
    for (const event of events) {
      if (event.kind === "output") next = acceptSequence(next, event.sequence);
      if (event.kind === "replay_gap") next = event.nextSequence;
    }
    this.expectedSequence = next;
  }

  private async pump() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    try {
      while (this.pending.length && !this.disposed) {
        const item = this.pending[0];
        await Promise.race([this.ports.render(item.events), this.stopped]);
        if (this.disposed) return;
        this.pending.shift();
        this.bytes -= item.bytes;
        this.events -= item.events.length;
        if (!item.receipt) continue;
        this.batches -= 1;
        const accepted = await Promise.race([this.ports.acknowledge(item.receipt), this.stopped]);
        if (!this.disposed && !accepted) throw new Error("终端输出消费确认失败，请重新连接。");
      }
    } catch (error) { this.fail(error); }
    finally { this.busy = false; }
  }

  private fail(error: unknown) {
    if (this.disposed) return;
    this.dispose();
    this.ports.fail(error);
  }
}

function eventBytes(event: TerminalStreamEvent) {
  if (event.kind === "output") return event.bytes.length + OUTPUT_EVENT_OVERHEAD;
  if (event.kind === "disconnected") return event.message.length + OUTPUT_EVENT_OVERHEAD;
  if (event.kind === "agent_state") {
    return CONTROL_EVENT_OVERHEAD + event.snapshot.reason.length + (event.snapshot.transcriptPath?.length ?? 0)
      + (event.snapshot.session?.id.length ?? 0);
  }
  return CONTROL_EVENT_OVERHEAD;
}
