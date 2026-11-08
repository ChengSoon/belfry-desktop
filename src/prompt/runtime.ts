import { t } from "../i18n";
import type { PromptDeliveryResult, TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { pathKey } from "../workspace/path";
import { canDispatchPrompt, isAgentKind, isPromptBusy, type PromptQueueItem, type PromptQueueUpdate, type PromptSubmitOptions, type PromptSubmitResult } from "./contracts";
import { createPromptQueueItem, nextPrompt, removePrompt } from "./queue";

export const PROMPT_CONFIRM_TIMEOUT_MS = 15_000;
/**
 * 回车之后输入区空了、又过了这么久，就算提交成功。短消息 Agent 一两秒就处理完，
 * 读屏可能一帧都没看到「正在工作」——只等那个信号会把它误判成没提交。
 */
export const PROMPT_EMPTY_CONFIRM_MS = 1_500;

export interface PausedDelivery {
  tabId: string;
  message: string;
}
interface InFlightPrompt {
  item: PromptQueueItem;
  target: TerminalCommandTarget;
  startedAt: number;
  submitted: boolean;
  sessionId: string | null;
  issue?: string;
  resolved?: boolean;
}

/** 接管、PTY 提交和 Agent 开始处理是不同阶段；不确定的输入不能盲目重贴。 */
export class PromptQueueRuntime {
  private queue: PromptQueueItem[] = [];
  private inFlight = new Map<string, InFlightPrompt>();
  private paused = new Map<string, InFlightPrompt>();
  private observers = new Map<string, PromptSubmitOptions>();

  get items(): readonly PromptQueueItem[] { return this.queue; }

  /** 暂停中的会话与原因，房间界面拿它显示「消息暂停了」。 */
  pausedDeliveries(): PausedDelivery[] {
    return [...this.paused.entries()].map(([tabId, pending]) => ({ tabId, message: pending.issue ?? "" }));
  }

  /** A durable manual decision resolves this task, but residual input still blocks later tasks. */
  resolvePersisted(id: string): boolean {
    const pending = [...this.paused.values(), ...this.inFlight.values()].find(pending => pending.item.id === id);
    if (!pending) return false;
    pending.resolved = true;
    this.observers.delete(id);
    return true;
  }

  /** 用户在终端里核对过了：放开暂停，后面的消息接着送。 */
  resume(tabId: string): boolean {
    const pending = this.paused.get(tabId);
    if (!pending) return false;
    this.paused.delete(tabId);
    this.update(pending.item.id, { state: "submitted" });
    return true;
  }

  submit(
    tabs: readonly WorkspaceTab[],
    targets: ReadonlyMap<string, TerminalCommandTarget>,
    tabId: string,
    rawText: string,
    options?: PromptSubmitOptions,
  ): PromptSubmitResult {
    const text = rawText.replace(/\r\n/gu, "\n").trimEnd();
    const tab = findAgentTab(tabs, tabId);
    if (!text.trim() || !tab || tab.phase === "exited" || tab.phase === "error") return "unavailable";
    if (options?.projectRoot && pathKey(options.projectRoot) !== pathKey(tab.project.rootPath)) return "unavailable";
    if (options?.id && (this.queue.some((item) => item.id === options.id)
      || [...this.inFlight.values(), ...this.paused.values()].some(({ item }) => item.id === options.id))) return "unavailable";
    this.reconcileTarget(tab.id, targets.get(tab.id));
    const firstForTab = nextPrompt(this.queue, tabId) === null && !this.inFlight.has(tabId);
    const item = createPromptQueueItem(tabId, text);
    if (options?.id) item.id = options.id;
    if (options) this.observers.set(item.id, options);
    this.queue = [...this.queue, item];
    this.update(item.id, { state: "queued" });
    const sent = this.dispatch(tab, targets);
    return firstForTab && sent ? "sent" : "queued";
  }

  sync(tabs: readonly WorkspaceTab[], targets: ReadonlyMap<string, TerminalCommandTarget>) {
    const alive = new Set(tabs.filter((tab) => isAgentKind(tab.kind) && tab.phase !== "exited" && tab.phase !== "error").map((tab) => tab.id));
    this.queue = this.queue.filter((item) => {
      const tab = tabs.find((candidate) => candidate.id === item.tabId);
      if (alive.has(item.tabId) && tab && this.matchesProject(item, tab)) return true;
      this.update(item.id, { state: "cancelled", message: t("prompt.runtime.text_170a45f4ad") });
      return false;
    });
    for (const pending of [...this.inFlight.values(), ...this.paused.values()]) {
      if (alive.has(pending.item.tabId)) continue;
      this.update(pending.item.id, { state: "attention", message: t("prompt.runtime.text_149d4fff97") });
      this.inFlight.delete(pending.item.tabId);
      this.paused.delete(pending.item.tabId);
    }
    for (const tab of tabs) this.syncTab(tab, targets);
  }

  cancel(id: string): boolean {
    if (!this.queue.some((item) => item.id === id)) return false;
    this.queue = removePrompt(this.queue, id);
    this.update(id, { state: "cancelled", message: t("prompt.runtime.text_b169186a2e") });
    return true;
  }

  private syncTab(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>) {
    if (!isAgentKind(tab.kind) || tab.phase !== "running") return;
    if (isPromptBusy(tab)) {
      // 包括用户手动确认当前输入；后续任务等它回到 idle 再发送。
      const pending = this.inFlight.get(tab.id);
      if (pending && !pending.submitted) this.update(pending.item.id, {
        state: "attention", message: t("prompt.runtime.text_0e00f89a3c"),
      });
      this.inFlight.delete(tab.id);
      this.paused.delete(tab.id);
      return;
    }
    this.reconcileTarget(tab.id, targets.get(tab.id));
    const paused = this.paused.get(tab.id);
    if (paused?.resolved && paused.target.composerEmpty?.()) this.paused.delete(tab.id);
    const pending = this.inFlight.get(tab.id);
    const elapsed = pending ? Date.now() - pending.startedAt : 0;
    if ((pending?.submitted || pending?.resolved) && elapsed >= PROMPT_EMPTY_CONFIRM_MS && pending.target.composerEmpty?.()) {
      // 回车已经写进去、输入区也空了：任务被提交走了，Agent 只是处理得太快没被看到在工作。
      this.inFlight.delete(tab.id);
      this.dispatch(tab, targets);
      return;
    }
    if (pending && elapsed >= PROMPT_CONFIRM_TIMEOUT_MS) {
      this.pause(tab.id, pending, t("prompt.runtime.text_7f5b31fc2f"));
    }
    this.dispatch(tab, targets);
  }

  private dispatch(tab: WorkspaceTab, targets: ReadonlyMap<string, TerminalCommandTarget>): boolean {
    if (!canDispatchPrompt(tab) || this.inFlight.has(tab.id) || this.paused.has(tab.id)) return false;
    const item = nextPrompt(this.queue, tab.id);
    const target = targets.get(tab.id);
    if (!item || !target) return false;
    if (!this.matchesProject(item, tab)) {
      this.queue = removePrompt(this.queue, item.id);
      this.update(item.id, { state: "cancelled", message: t("prompt.runtime.text_1a3998ba0b") });
      return this.dispatch(tab, targets);
    }
    const pending: InFlightPrompt = { item, target, startedAt: Date.now(), submitted: false,
      sessionId: target.getSessionId?.() ?? null };
    this.inFlight.set(tab.id, pending);
    // 先移除再调用，兼容同步结果回调；未接管时再恢复到队首。
    this.queue = removePrompt(this.queue, item.id);
    this.update(item.id, { state: "sending" });
    const beforeSend = this.observers.get(item.id)?.beforeSend;
    if (beforeSend) {
      let permission: Promise<boolean>;
      try { permission = beforeSend(); }
      catch { this.requeueInFlight(tab.id); return false; }
      void permission.then((allowed) => {
        if (this.inFlight.get(tab.id) !== pending || pending.resolved) return;
        if (!allowed) {
          this.inFlight.delete(tab.id);
          this.update(item.id, { state: "cancelled", message: t("prompt.runtime.text_1b2ea5dbb0") });
        } else if (pending.target !== target) {
          this.requeueInFlight(tab.id);
        } else {
          pending.startedAt = Date.now();
          this.sendToTarget(tab.id, pending, target);
        }
      }).catch(() => {
        if (this.inFlight.get(tab.id) === pending) this.requeueInFlight(tab.id);
      });
      return true;
    }
    return this.sendToTarget(tab.id, pending, target);
  }

  private sendToTarget(tabId: string, pending: InFlightPrompt, target: TerminalCommandTarget): boolean {
    let accepted = false;
    try {
      accepted = target.sendText(pending.item.text, {
        background: true,
        onResult: (result) => this.deliveryResult(tabId, pending, result),
      });
    } catch {
      this.pause(tabId, pending, t("prompt.runtime.text_9fd30020f3"));
      return true;
    }
    if (!accepted) {
      this.requeueInFlight(tabId);
      return false;
    }
    return true;
  }

  private deliveryResult(tabId: string, pending: InFlightPrompt, result: PromptDeliveryResult) {
    if (pending.resolved) return;
    if (this.inFlight.get(tabId) !== pending && this.paused.get(tabId) !== pending) return;
    if (result === "submitted") {
      pending.submitted = true;
      this.update(pending.item.id, { state: "submitted" });
      return;
    }
    if (result === "not-written") {
      this.requeueInFlight(tabId);
      return;
    }
    this.pause(tabId, pending, result === "cancelled"
      ? t("prompt.runtime.text_18d27d4e4d")
      : result === "detached"
        ? t("prompt.runtime.text_7c2c6c7751")
        : t("prompt.runtime.text_0c451864cd"));
  }

  private pause(tabId: string, pending: InFlightPrompt, message: string) {
    this.inFlight.delete(tabId);
    if (this.paused.get(tabId) === pending && pending.issue) return;
    pending.issue = message;
    this.paused.set(tabId, pending);
    this.update(pending.item.id, { state: "attention", message });
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
        this.pause(tabId, pending, t("prompt.runtime.text_6d7cfaeab9"));
      }
    }
  }

  private requeueInFlight(tabId: string) {
    const pending = this.inFlight.get(tabId) ?? this.paused.get(tabId);
    if (!pending) return;
    this.inFlight.delete(tabId);
    this.paused.delete(tabId);
    // Enter 已写入后重挂不能再重贴，否则会重复执行同一任务。
    if (pending.submitted || pending.resolved) return;
    if (!this.queue.some((candidate) => candidate.id === pending.item.id)) {
      this.queue = [pending.item, ...this.queue];
      this.update(pending.item.id, { state: "queued" });
    }
  }

  private matchesProject(item: PromptQueueItem, tab: WorkspaceTab) {
    const root = this.observers.get(item.id)?.projectRoot;
    return !root || pathKey(root) === pathKey(tab.project.rootPath);
  }

  private update(id: string, update: PromptQueueUpdate) {
    const observer = this.observers.get(id);
    if (update.state === "submitted" || update.state === "cancelled") this.observers.delete(id);
    // UI 的回执处理不能打断终端投递。
    try { observer?.onUpdate?.(update); } catch { /* The input queue remains authoritative. */ }
  }
}

function findAgentTab(tabs: readonly WorkspaceTab[], tabId: string) {
  const tab = tabs.find((candidate) => candidate.id === tabId);
  return tab && isAgentKind(tab.kind) ? tab : null;
}
