import type { SessionActivity } from "../terminal/contracts";
import type { WorkspaceTabKind } from "../workspace/contracts";

/**
 * 只有两件事值得打断用户：Agent 把活干完了，或者它卡在一个非你点头不可的问题上。
 * 其余跃迁一律沉默——通知误报一次，用户就再也不会认真看第二次。
 */
export type NotifyReason = "finished" | "awaiting-choice";

/**
 * `talking → idle` 不能当场认定是"干完了"。
 *
 * activity 是每 200ms 扫一次屏幕文本猜出来的（terminal/activity.ts），Agent 在两次工具
 * 调用之间、或者输出把 spinner 那行刷掉的瞬间，都可能被读成一帧 idle。更常见的是
 * `talking → idle → awaiting-choice`：spinner 先消失，权限框隔一拍才画出来。抢在这中间
 * 发一条"已跑完"，紧接着再发"在等你确认"，第一条就是纯粹的误报。
 *
 * 所以完成通知要压一会儿再发，期间只要状态再变就作废。1500ms 比权限框渲染的间隔宽裕，
 * 又不至于让真正跑完的通知迟到到能被察觉。
 */
export const FINISHED_CONFIRM_MS = 1500;

/**
 * 判定一次 activity 跃迁该不该通知。只看跃迁本身，不掺可见性——
 * 完成通知要压 1500ms 才发，那时候用户在看哪条会话已经和此刻无关了。
 */
export function classifyTransition(
  from: SessionActivity,
  to: SessionActivity,
  kind: WorkspaceTabKind,
): NotifyReason | null {
  // Shell / SSH 会话的 activity 恒为 idle，跃迁本不该发生；真发生了也没有 Agent 可等。
  if (kind === "shell" || kind === "ssh") return null;
  if (from === to) return null;
  // 进入等待选择：最该打扰的一种，不去点它就一直卡着。
  if (to === "awaiting-choice") return "awaiting-choice";
  // 只认 talking → idle。awaiting-choice → idle 是用户刚回答完，人就在屏幕前。
  if (from === "talking" && to === "idle") return "finished";
  return null;
}

/** 用户正盯着这条会话看的时候别弹通知——他已经看见了。 */
export function shouldSuppress(windowFocused: boolean, sessionVisible: boolean): boolean {
  return windowFocused && sessionVisible;
}

export interface NotifyContent {
  title: string;
  body: string;
}

const REASON_TITLE: Record<NotifyReason, string> = {
  finished: "已跑完",
  "awaiting-choice": "在等你确认",
};

/**
 * 状态放 title、身份放 body：用户扫一眼通知，先要判断的是"要不要现在去处理"，
 * 其次才是"哪条会话"。
 */
export function notifyContent(
  reason: NotifyReason,
  projectName: string,
  sessionTitle: string,
): NotifyContent {
  return {
    title: REASON_TITLE[reason],
    body: `${projectName} · ${sessionTitle}`,
  };
}
