import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { canDispatchPrompt, isAgentKind, isPromptBusy, type PromptQueueItem, type PromptSubmitResult } from "./contracts";
import { createPromptQueueItem, nextPrompt, removePrompt } from "./queue";

/**
 * Prompt 队列的可测试运行时。已交给 xterm、但尚未看到 Agent 忙碌信号的项单独暂存；
 * PTY 在这个窗口重挂时把它放回队首，避免输入尚未写入 PTY 就被静默丢弃。
 */
export class PromptQueueRuntime {
  private queue: PromptQueueItem[] = [];
  private inFlight = new Map<string, { item: PromptQueueItem; target: TerminalCommandTarget }>();

  get items(): readonly PromptQueueItem[] {
    return this.queue;
  }

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

  remove(id: string) {
    this.queue = removePrompt(this.queue, id);
  }

  sendNow(
    tabs: readonly WorkspaceTab[],
    targets: ReadonlyMap<string, TerminalCommandTarget>,
    tabId: string,
  ) {
    const tab = findAgentTab(tabs, tabId);
    this.reconcileTarget(tabId, targets.get(tabId));
    return tab ? this.dispatch(tab, targets) : false;
  }

  sync(tabs: readonly WorkspaceTab[], targets: ReadonlyMap<string, TerminalCommandTarget>) {
    const alive = new Set(tabs.map((tab) => tab.id));
    this.queue = this.queue.filter((item) => alive.has(item.tabId));
    for (const tabId of this.inFlight.keys()) {
      if (!alive.has(tabId)) this.inFlight.delete(tabId);
    }

    for (const tab of tabs) this.syncTab(tab, targets);
  }

  private syncTab(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>) {
    if (!isAgentKind(tab.kind) || tab.phase !== "running") {
      this.requeueInFlight(tab.id);
      return;
    }
    if (isPromptBusy(tab)) {
      // Agent 已经开始处理，交给 xterm 的项可确认送达；下一条等它回到 idle。
      this.inFlight.delete(tab.id);
      return;
    }
    this.reconcileTarget(tab.id, targets.get(tab.id));
    this.dispatch(tab, targets);
  }

  private dispatch(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>) {
    if (!canDispatchPrompt(tab) || this.inFlight.has(tab.id)) return false;
    const item = nextPrompt(this.queue, tab.id);
    const target = targets.get(tab.id);
    if (!item || !target) return false;

    let sent = false;
    try {
      sent = target.sendText(item.text);
    } catch {
      sent = false;
    }
    if (!sent) return false;

    this.queue = removePrompt(this.queue, item.id);
    this.inFlight.set(tab.id, { item, target });
    return true;
  }

  private reconcileTarget(tabId: string, target: TerminalCommandTarget | undefined) {
    const inFlight = this.inFlight.get(tabId);
    if (inFlight && inFlight.target !== target) this.requeueInFlight(tabId);
  }

  private requeueInFlight(tabId: string) {
    const inFlight = this.inFlight.get(tabId);
    if (!inFlight) return;
    this.inFlight.delete(tabId);
    if (!this.queue.some((candidate) => candidate.id === inFlight.item.id)) {
      this.queue = [inFlight.item, ...this.queue];
    }
  }
}

function findAgentTab(tabs: readonly WorkspaceTab[], tabId: string) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  return tab && isAgentKind(tab.kind) ? tab : null;
}
