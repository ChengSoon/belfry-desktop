import type { PendingReview } from "./api";

export interface ReviewNotifierSinks {
  /** 真正要提醒的那一条。 */
  notify: (review: PendingReview) => void;
  /** 用户正看着房间（窗口在前台且视图开着）时不打扰。 */
  quiet: () => boolean;
}

/**
 * 「已提交待验证」的跃迁检测。
 *
 * 首次拿到清单只做基线、一条都不弹——那是应用启动时已有的存量，弹出来只会
 * 是一串旧账。之后只对「新进入待验证」的任务提醒一次；安静期里错过的不补发。
 * 状态放在类里而不是 React 里：轮询跨渲染存活，语义也能在没有 jsdom 的仓库里
 * 直接测（同 ActivityNotifier 的取舍）。
 */
export class ReviewNotifier {
  private readonly sinks: ReviewNotifierSinks;
  private seen: Set<string> | null = null;

  constructor(sinks: ReviewNotifierSinks) {
    this.sinks = sinks;
  }

  sync(pending: readonly PendingReview[]): void {
    const current = new Set(pending.map((review) => review.taskId));
    if (this.seen !== null) {
      for (const review of pending) {
        if (this.seen.has(review.taskId)) continue;
        if (this.sinks.quiet()) continue;
        this.sinks.notify(review);
      }
    }
    this.seen = current;
  }
}
