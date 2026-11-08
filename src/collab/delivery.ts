import type { PromptQueueUpdate, PromptSubmitOptions, PromptSubmitResult } from "../prompt/contracts";
import type { DeliveryPhase, DeliveryUpdate, PendingTask } from "./api";

export interface DeliveryPorts {
  fetch: () => Promise<PendingTask[]>;
  claim: (id: string, attemptId: string) => Promise<boolean>;
  release: (id: string, attemptId: string) => Promise<void>;
  receipt: (update: DeliveryUpdate) => Promise<boolean>;
  submit: (tabId: string, text: string, options: PromptSubmitOptions) => PromptSubmitResult;
}
interface Attempt { id: string; attemptId: string; queued: boolean; sequence: number; receipts: DeliveryUpdate[]; releasing?: boolean; resolved?: boolean }

/** 回执失败只重试原回执。写入前的 durable intent 是重启后“不确定、禁止自动重贴”的依据。 */
export class DeliveryCoordinator {
  private attempts = new Map<string, Attempt>();

  resolvePersisted(id: string) {
    const attempt = this.attempts.get(id);
    if (attempt) { attempt.resolved = true; attempt.receipts = []; this.attempts.delete(id); }
  }

  async tick(ports: DeliveryPorts): Promise<number> {
    // 先补交回执：拉取待投递失败，也不能丢掉已写入终端的事实。
    let count = await this.flush(ports);
    const tasks = await ports.fetch();
    for (const task of tasks) {
      let attempt = this.attempts.get(task.id);
      if (!attempt) {
        attempt = { id: task.id, attemptId: crypto.randomUUID(), queued: false, sequence: 0, receipts: [] };
        this.attempts.set(task.id, attempt);
      }
      if (attempt.queued) continue;
      if (!await ports.claim(task.id, attempt.attemptId)) { this.attempts.delete(task.id); continue; }
      const current = attempt;
      current.queued = true;
      let gateStarted = false;
      let invalidated = false;
      let result: PromptSubmitResult;
      try {
        result = ports.submit(task.to, task.text, {
          id: task.id,
          beforeSend: async () => {
            if (invalidated || current.resolved) return false;
            gateStarted = true;
            const allowed = await ports.receipt(this.update(current, "submitting"));
            return allowed && !invalidated;
          },
          onUpdate: (update) => {
            const phase = receiptPhase(update);
            if (!invalidated && !current.resolved && phase) current.receipts.push(this.update(current, phase, update.message));
          },
        });
      } catch (error) {
        invalidated = true;
        if (gateStarted) {
          current.receipts.push(this.update(current, "uncertain", "Prompt submission failed after the delivery gate started."));
        } else {
          current.receipts = [];
          current.releasing = true;
          await this.flush(ports);
        }
        throw error;
      }
      if (result === "unavailable") {
        invalidated = true;
        current.receipts = [];
        current.releasing = true;
        await this.flush(ports);
      }
    }
    count += await this.flush(ports);
    return count;
  }

  private async flush(ports: DeliveryPorts): Promise<number> {
    let count = 0;
    for (const attempt of this.attempts.values()) {
      if (attempt.releasing) {
        await ports.release(attempt.id, attempt.attemptId);
        this.attempts.delete(attempt.id);
        continue;
      }
      while (attempt.receipts.length) {
        const receipt = attempt.receipts[0];
        await ports.receipt(receipt);
        attempt.receipts = attempt.receipts.filter((item) => item.sequence !== receipt.sequence);
        count += 1;
        if (receipt.phase === "submitted" || receipt.phase === "cancelled") this.attempts.delete(attempt.id);
      }
    }
    return count;
  }

  private update(attempt: Attempt, phase: DeliveryPhase, message?: string): DeliveryUpdate {
    return { id: attempt.id, attemptId: attempt.attemptId, sequence: ++attempt.sequence, phase, message };
  }
}

function receiptPhase(update: PromptQueueUpdate): DeliveryPhase | null {
  switch (update.state) {
    case "queued": return "queued";
    case "submitted": return "submitted";
    case "attention": return "uncertain";
    case "cancelled": return "cancelled";
    case "sending": return null; // 提交意图由 beforeSend 等待持久化。
  }
}
