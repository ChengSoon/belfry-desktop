import type { PromptDeliveryResult, TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { canDispatchPrompt, isAgentKind, isPromptBusy, type PromptQueueItem, type PromptSubmitResult } from "./contracts";
import { createPromptQueueItem, nextPrompt, removePrompt } from "./queue";

export const PROMPT_CONFIRM_TIMEOUT_MS = 15_000;
interface InFlightPrompt {
  item: PromptQueueItem;
  target: TerminalCommandTarget;
  startedAt: number;
  submitted: boolean;
  sessionId: string | null;
  issue?: string;
}

/** 接管、PTY 提交和 Agent 开始处理是不同阶段；不确定的输入不能盲目重贴。 */
export class PromptQueueRuntime {
  private queue: PromptQueueItem[] = [];
  private inFlight = new Map<string, InFlightPrompt>();
  private paused = new Map<string, InFlightPrompt>();

  get items(): readonly PromptQueueItem[] { return this.queue; }

  submit(
    tabs: readonly WorkspaceTab[],
    targets: ReadonlyMap<string, TerminalCommandTarget>,
    tabId: string,
    rawText: string,
  ): PromptSubmitResult {
    const text = rawText.replace(/\r\n/gu, "\n").trimEnd();
    const tab = findAgentTab(tabs, tabId);
    if (!text.trim() || !tab || tab.phase === "exited" || tab.phase === "error") return "unavailable";
    this.reconcileTarget(tab.id, targets.get(tab.id));
    const firstForTab = nextPrompt(this.queue, tabId) === null && !this.inFlight.has(tabId);
    this.queue = [...this.queue, createPromptQueueItem(tabId, text)];
    const sent = this.dispatch(tab, targets);
    return firstForTab && sent ? "sent" : "queued";
  }

  sync(tabs: readonly WorkspaceTab[], targets: ReadonlyMap<string, TerminalCommandTarget>) {
    const alive = new Set(tabs.map((tab) => tab.id));
    this.queue = this.queue.filter((item) => alive.has(item.tabId));
    for (const tabId of this.inFlight.keys()) if (!alive.has(tabId)) this.inFlight.delete(tabId);
    for (const tabId of this.paused.keys()) if (!alive.has(tabId)) this.paused.delete(tabId);
    for (const tab of tabs) this.syncTab(tab, targets);
  }

  private syncTab(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>) {
    if (!isAgentKind(tab.kind) || tab.phase !== "running") return;
    if (isPromptBusy(tab)) {
      // 包括用户手动确认当前输入；后续任务等它回到 idle 再发送。
      this.inFlight.delete(tab.id);
      this.paused.delete(tab.id);
      return;
    }
    this.reconcileTarget(tab.id, targets.get(tab.id));
    const pending = this.inFlight.get(tab.id);
    if (pending && Date.now() - pending.startedAt >= PROMPT_CONFIRM_TIMEOUT_MS) {
      this.pause(tab.id, pending, "协作任务尚未确认开始处理，已暂停后续自动投递。请检查输入区，必要时手动按 Enter；不要重复粘贴任务。");
    }
    this.dispatch(tab, targets);
  }

  private dispatch(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>) {
    if (!canDispatchPrompt(tab) || this.inFlight.has(tab.id) || this.paused.has(tab.id)) return false;
    const item = nextPrompt(this.queue, tab.id);
    const target = targets.get(tab.id);
    if (!item || !target) return false;
    const pending: InFlightPrompt = { item, target, startedAt: Date.now(), submitted: false,
      sessionId: target.getSessionId?.() ?? null };
    this.inFlight.set(tab.id, pending);
    // 先移除再调用，兼容同步结果回调；未接管时再恢复到队首。
    this.queue = removePrompt(this.queue, item.id);
    let accepted = false;
    try {
      accepted = target.sendText(item.text, {
        background: true,
        onResult: (result) => this.deliveryResult(tab.id, pending, result),
      });
    } catch { accepted = false; }
    if (!accepted) {
      this.requeueInFlight(tab.id);
      return false;
    }
    return true;
  }

  private deliveryResult(tabId: string, pending: InFlightPrompt, result: PromptDeliveryResult) {
    if (this.inFlight.get(tabId) !== pending && this.paused.get(tabId) !== pending) return;
    if (result === "submitted") {
      pending.submitted = true;
      return;
    }
    if (result === "not-written") {
      this.requeueInFlight(tabId);
      return;
    }
    this.pause(tabId, pending, result === "cancelled"
      ? "用户输入中断了协作任务的自动回车，已暂停后续投递。请检查当前输入并手动提交；Agent 开始处理后队列会继续。"
      : result === "detached"
        ? "协作任务写入后终端连接中断，未自动重贴任务。请检查重连后的输入并手动确认，避免重复执行。"
        : "协作任务输入写入失败，已暂停后续投递。请检查输入区后手动提交；同一终端重连不会清除残留输入，未自动重贴任务。");
  }

  private pause(tabId: string, pending: InFlightPrompt, message: string) {
    this.inFlight.delete(tabId);
    if (this.paused.get(tabId) === pending && pending.issue) return;
    pending.issue = message;
    this.paused.set(tabId, pending);
    pending.target.notifyInputIssue?.(message);
  }

  private reconcileTarget(tabId: string, target: TerminalCommandTarget | undefined) {
    const sessionId = target?.getSessionId?.() ?? null;
    const paused = this.paused.get(tabId);
    if (paused && target) {
      if (paused.sessionId && sessionId && paused.sessionId !== sessionId) {
        this.paused.delete(tabId); // 真正的新 PTY 没有旧输入残留。
      } else if (paused.target !== target) {
        paused.target = target;
        if (paused.issue) target.notifyInputIssue?.(paused.issue);
      }
    }
    const pending = this.inFlight.get(tabId);
    if (pending && target && pending.target !== target) {
      if (pending.submitted) {
        if (pending.sessionId && sessionId && pending.sessionId !== sessionId) this.inFlight.delete(tabId);
        else pending.target = target;
      } else {
        pending.target = target;
        this.pause(tabId, pending, "终端重新连接，但协作任务写入状态尚未确认。请检查输入区后手动提交；未自动重贴任务。");
      }
    }
  }

  private requeueInFlight(tabId: string) {
    const pending = this.inFlight.get(tabId) ?? this.paused.get(tabId);
    if (!pending) return;
    this.inFlight.delete(tabId);
    this.paused.delete(tabId);
    // Enter 已写入后重挂不能再重贴，否则会重复执行同一任务。
    if (pending.submitted) return;
    if (!this.queue.some((candidate) => candidate.id === pending.item.id)) {
      this.queue = [pending.item, ...this.queue];
    }
  }
}

function findAgentTab(tabs: readonly WorkspaceTab[], tabId: string) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  return tab && isAgentKind(tab.kind) ? tab : null;
}
