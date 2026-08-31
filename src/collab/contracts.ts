import { isAgentKind } from "../prompt/contracts";
import type { WorkspaceTab } from "../workspace/contracts";

/**
 * 一条会话在名册里的样子。字段与 Rust 侧 `collab::registry::SessionSnapshot` 一一对应。
 *
 * 会话状态只活在前端，而控制 CLI 是从 PTY 里连进来问「现在有谁在」的，那时前端
 * 不在调用栈上——所以要主动把这份快照推给 Rust。
 */
export interface SessionSnapshot {
  tabId: string;
  /**
   * 用户起的唯一名。派活只认它。
   *
   * null 表示还没命名——这条会话能看见别人，但别人寻址不到它。
   */
  name: string | null;
  title: string;
  /** `codex` / `claude` / 以后接入的其他。开放字符串：协作层不比较具体取值。 */
  agent: string;
  activity: string;
  /** 能不能给它派活。前端按会话状态算好，Rust 原样转发给 CLI。 */
  canReceive: boolean;
  projectRoot: string;
}

/**
 * 能不能现在给这条会话派活。
 *
 * 三种「不能」的理由完全不同，但对派活方是同一个结论：
 * - `talking` 正忙——可以排队等它闲下来。
 * - `awaiting-choice` 卡在权限框——**绝不能**投递，文字会 paste 进那个框，
 *   可能替用户选中一个选项。项目用 `--dangerously-skip-permissions` 起 Claude，
 *   这一脚踩下去没有回头路。
 * - `exited` / `error` 进程没了——投了也没人看。
 */
export function canReceiveWork(tab: WorkspaceTab) {
  return isAgentKind(tab.kind) && tab.phase === "running" && tab.activity === "idle";
}

/**
 * 只把 Agent 会话放进名册。
 *
 * Shell 和 SSH 拿不到身份牌，本来就用不了 `belfry`，也接不了活；列进去只会让
 * `belfry peers` 多出几行永远 `canReceive: false` 的噪声。而它们的 activity 恒为
 * idle（屏幕启发式刻意不猜非 Agent 会话），显示出来反而误导。
 */
export function toSessionRoster(tabs: readonly WorkspaceTab[]): SessionSnapshot[] {
  return tabs.filter((tab) => isAgentKind(tab.kind)).map((tab) => ({
    tabId: tab.id,
    name: tab.agentName,
    title: tab.title,
    agent: tab.kind,
    activity: tab.activity,
    canReceive: canReceiveWork(tab),
    projectRoot: tab.project.rootPath,
  }));
}
