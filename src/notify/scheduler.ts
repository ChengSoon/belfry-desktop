import type { SessionActivity } from "../terminal/contracts";
import type { WorkspaceTabKind } from "../workspace/contracts";
import { notify as sendNotify, setBadge as applyBadge } from "./api";
import {
  FINISHED_CONFIRM_MS,
  classifyTransition,
  notifyContent,
  shouldSuppress,
  type NotifyContent,
  type NotifyReason,
} from "./rules";

/**
 * 通知调度只认这几个字段。剥掉 WorkspaceTab 的其余部分，这套时序才测得动——
 * 仓库没装 jsdom，跟 React 绑在一起的逻辑一行都验不了。
 */
export interface NotifiableSession {
  id: string;
  kind: WorkspaceTabKind;
  activity: SessionActivity;
  title: string;
  project: { name: string };
}

export interface NotifySinks {
  notify: (content: NotifyContent) => void;
  setBadge: (count: number) => void;
}

/**
 * 把 activity 跃迁翻译成通知与角标。
 *
 * 状态全在这儿而不在 React 里：完成通知要压 1500ms 才发，那条定时器的存活期跨越
 * 若干次渲染，挂在 effect 上会被反复清掉（终端一刷屏 tabs 就是个新数组）。
 */
export class ActivityNotifier {
  private readonly sinks: NotifySinks;
  /** 上次见到的 activity。查不到 = 会话刚进视野，不能当跃迁。 */
  private readonly seen = new Map<string, SessionActivity>();
  /** 压着等确认的完成通知。 */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
  /** 已通知完成、用户还没回来看的会话。只用来算角标。 */
  private readonly unread = new Set<string>();
  private sessions: readonly NotifiableSession[] = [];
  private visible: ReadonlySet<string> = new Set();
  private focused = true;

  constructor(sinks: NotifySinks = { notify: sendNotify, setBadge: applyBadge }) {
    this.sinks = sinks;
  }

  /** 会话、可见集合、窗口焦点，任何一样变了都喂进来。 */
  sync(
    sessions: readonly NotifiableSession[],
    visible: ReadonlySet<string>,
    focused: boolean,
  ): void {
    this.sessions = sessions;
    this.visible = visible;
    this.focused = focused;

    const live = new Set<string>();
    for (const session of sessions) {
      live.add(session.id);
      const before = this.seen.get(session.id);
      this.seen.set(session.id, session.activity);
      if (before === undefined || before === session.activity) continue;

      // 状态但凡再动一下，压着的那条"已跑完"就作废。典型序列是
      // talking → idle → awaiting-choice：spinner 先没，权限框隔一拍才画出来。
      this.cancel(session.id);
      const reason = classifyTransition(before, session.activity, session.kind);
      if (reason === "awaiting-choice") {
        this.deliver(session.id, reason);
      } else if (reason === "finished") {
        this.pending.set(
          session.id,
          setTimeout(() => this.deliver(session.id, "finished"), FINISHED_CONFIRM_MS),
        );
      }
    }

    for (const id of this.seen.keys()) {
      if (!live.has(id)) this.seen.delete(id);
    }
    for (const id of this.pending.keys()) {
      if (!live.has(id)) this.cancel(id);
    }
    this.reconcile();
  }

  dispose(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private cancel(id: string) {
    const timer = this.pending.get(id);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.pending.delete(id);
  }

  private deliver(id: string, reason: NotifyReason) {
    this.pending.delete(id);
    // 压了 1500ms 才发的通知，这期间会话可能已经被关掉了。
    const session = this.sessions.find((item) => item.id === id);
    if (!session) return;
    // 可见性要在发送这一刻才看：决策时用户在别处，等通知真要出去时他可能已经回来了。
    if (shouldSuppress(this.focused, this.visible.has(id))) return;
    this.sinks.notify(notifyContent(reason, session.project.name, session.title));
    if (reason === "finished") this.unread.add(id);
    this.reconcile();
  }

  /** 收拾未读集合并把角标刷成当前真实值。 */
  private reconcile() {
    const live = new Set(this.sessions.map((session) => session.id));
    for (const id of this.unread) {
      if (!live.has(id) || (this.focused && this.visible.has(id))) this.unread.delete(id);
    }
    // 等待确认的会话不进 unread：它自带持续状态，直接照着 activity 数，
    // 用户一答完角标自己就掉了。
    const waiting = this.sessions.filter(
      (session) => session.activity === "awaiting-choice",
    ).length;
    this.sinks.setBadge(waiting + this.unread.size);
  }
}
