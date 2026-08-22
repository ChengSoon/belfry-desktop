import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import {
  canDispatchPrompt,
  isAgentKind,
  isPromptBusy,
  type PromptOrigin,
  type PromptQueueItem,
  type PromptSubmitResult,
} from "./contracts";
import { createPromptQueueItem, nextPrompt, removePrompt, removePromptsForRun } from "./queue";

/** Recipe 交给队列的一步。text 已经完成变量替换。 */
export interface PromptRunStep {
  stepId: string;
  text: string;
}

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

  /**
   * 把一轮 Recipe 的步骤一次塞进队列，随后按普通队列语义串行派发。
   *
   * 队列本身已经保证串行、等 `running + idle`、终端重挂回滚，所以 Recipe 不需要自己的
   * 执行引擎；Agent 卡在权限框时 `canDispatchPrompt` 不成立，整轮自然停住。
   *
   * `position: "head"` 供「重发这一步」使用：插到队首，下一次派发优先取它。
   */
  enqueueRun(
    tabs: readonly WorkspaceTab[],
    targets: ReadonlyMap<string, TerminalCommandTarget>,
    tabId: string,
    steps: readonly PromptRunStep[],
    runId: string,
    position: "head" | "tail" = "tail",
    kind: PromptOrigin["kind"] = "recipe",
  ): number {
    const tab = findAgentTab(tabs, tabId);
    if (!tab || tab.phase === "exited" || tab.phase === "error") return 0;

    const created = steps
      .map((step) => ({ step, text: step.text.replace(/\r\n/gu, "\n").trimEnd() }))
      .filter(({ text }) => text.trim().length > 0)
      .map(({ step, text }) => createPromptQueueItem(tabId, text, Date.now(), {
        kind,
        runId,
        stepId: step.stepId,
      }));
    if (created.length === 0) return 0;

    this.reconcileTarget(tab.id, targets.get(tab.id));
    this.queue = position === "head" ? [...created, ...this.queue] : [...this.queue, ...created];
    this.dispatch(tab, targets);
    return created.length;
  }

  /**
   * 中止一轮：清掉队列里剩余步骤。
   *
   * 同时丢弃属于这一轮的 in-flight 记录——它已经交给 xterm 了，拦不回来，但如果留着，
   * 之后一次终端重挂就会把它当「未确认」回滚进队列，让用户明明中止过的步骤又发一次。
   */
  removeRun(runId: string) {
    this.queue = removePromptsForRun(this.queue, runId);
    for (const [tabId, inFlight] of this.inFlight) {
      if (inFlight.item.origin?.runId === runId) this.inFlight.delete(tabId);
    }
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
