import { useEffect, useRef } from "react";
import type { WorkspaceTab } from "../workspace/contracts";
import { syncSessions } from "./api";
import { toSessionRoster } from "./contracts";

/**
 * 把会话名册同步给 Rust，让控制 CLI 能回答「现在有谁在」。
 *
 * 按内容去重：Codex / Claude 同步原始协议状态，其他 Agent 使用各自的活动来源。
 * 终端刷新时 tabs 会改变引用，名册内容经常没变，避免重复 IPC。
 */
export function useSessionRoster(tabs: readonly WorkspaceTab[]) {
  const pushed = useRef("");

  useEffect(() => {
    const roster = toSessionRoster(tabs);
    const serialized = JSON.stringify(roster);
    if (serialized === pushed.current) return;
    // 先记下再推，避免同一份名册被连续两次渲染各推一趟。
    pushed.current = serialized;
    void syncSessions(roster).catch(() => {
      // 协作是增强功能，推送失败不该影响主流程。但要把去重键清掉，
      // 否则这份名册再也不会重试——CLI 会一直看着一份过期的花名册。
      pushed.current = "";
    });
  }, [tabs]);
}
