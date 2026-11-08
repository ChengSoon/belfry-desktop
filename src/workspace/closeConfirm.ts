import { t } from "../i18n";
import type { WorkspaceTab } from "./contracts";

/**
 * 关会话前要不要拦一下。判据是"这一下会不会杀掉还活着的东西"——
 * exited / error 的进程早就没了，关掉只是把侧栏里一行灰记录擦掉，拦下来纯是添麻烦。
 *
 * 注意这只管侧栏那个 X（真删会话）。分屏窗格上的 X 走 closePane，
 * 会话和 PTY 都还活着，那一下没有代价，不该拦。
 */
export function needsCloseConfirm(tab: WorkspaceTab) {
  return tab.phase !== "exited" && tab.phase !== "error";
}

/**
 * 弹框正文。后半句所有情况都一样（关会话的代价就是这两件事），
 * 前半句只在会话正忙时补一句它在忙什么——那才是真正让手停下来的信息。
 */
export function closeConfirmBody(tab: WorkspaceTab) {
  const state = tab.phase === "creating" ? "starting" : tab.phase === "running" ? tab.activity : "idle";
  return t(`workspace.closeConfirm.${state}`);
}
