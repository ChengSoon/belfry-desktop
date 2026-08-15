import { useEffect, useRef } from "react";
import type { WorkspaceTab } from "../workspace/contracts";
import { ActivityNotifier } from "./scheduler";

/**
 * 把会话状态喂给通知调度器。
 *
 * 判定"要不要弹"需要知道窗口在不在前台、这条会话是不是正画在某个窗格里，
 * 而这两件事只有 App 层看得全，所以挂在这一层而不是终端内部。
 *
 * @param visibleTabIds 此刻真的画在舞台上的会话（分屏时是全部窗格，否则就是活动会话）。
 */
export function useActivityNotifications(
  tabs: WorkspaceTab[],
  visibleTabIds: ReadonlySet<string>,
) {
  const notifier = useRef<ActivityNotifier | null>(null);
  notifier.current ??= new ActivityNotifier();
  const focused = useRef(document.hasFocus());
  // 焦点事件是异步来的，那一刻拿不到渲染闭包里的 props，只能各留一份最新值。
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const visibleRef = useRef(visibleTabIds);
  visibleRef.current = visibleTabIds;

  useEffect(() => {
    notifier.current?.sync(tabs, visibleTabIds, focused.current);
  }, [tabs, visibleTabIds]);

  useEffect(() => {
    const push = () => {
      notifier.current?.sync(tabsRef.current, visibleRef.current, focused.current);
    };
    // 回到应用要立刻把已经看见的那些从角标里摘掉，所以焦点变化两头都得推一次。
    const onFocus = () => {
      focused.current = true;
      push();
    };
    const onBlur = () => {
      focused.current = false;
      push();
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // 只在真正卸载时收摊，所以依赖必须是空的：tabs 每刷一次屏这个 hook 就重跑一遍，
  // 顺手 dispose 的话，压着的完成通知永远发不出去。
  useEffect(() => () => notifier.current?.dispose(), []);
}
