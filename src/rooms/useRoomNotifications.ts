import { useEffect, useRef } from "react";
import { notify } from "../notify/api";
import { roomPendingReviews } from "./api";
import { ReviewNotifier } from "./reviewNotifier";

/** 提醒轮询比视图轮询慢一档：它不是真相来源，只是把人叫回来。 */
const POLL_INTERVAL_MS = 3_000;

/**
 * 房间任务的「已提交待验证」提醒。
 *
 * 挂在 App 层而不是房间视图里：只有视图开着才轮询的话，用户在主界面
 * 干活时永远等不到提醒。跃迁规则本身在 ReviewNotifier 里，这里只管接线。
 */
export function useRoomNotifications(roomsOpen: boolean) {
  const openRef = useRef(roomsOpen);
  openRef.current = roomsOpen;
  const notifier = useRef<ReviewNotifier | null>(null);
  notifier.current ??= new ReviewNotifier({
    notify: (review) => {
      void notify({
        title: `房间「${review.roomName}」有任务待验证`,
        body: `「${review.title}」已提交，等你确认。`,
      });
    },
    // 房间开着、窗口也在前台：用户马上就会看见，不必打扰。
    quiet: () => openRef.current && document.hasFocus(),
  });

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const pending = await roomPendingReviews();
        if (!cancelled) notifier.current?.sync(pending);
      } catch {
        // 提醒是增强不是主线：这一拍失败就等下一拍，房间里的事实不会因此改变。
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
}
