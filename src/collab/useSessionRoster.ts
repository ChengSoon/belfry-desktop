import { useEffect, useRef } from "react";
import type { WorkspaceTab } from "../workspace/contracts";
import { syncSessions } from "./api";
import { toSessionRoster } from "./contracts";

/**
 * 把会话名册同步给 Rust，让控制 CLI 能回答「现在有谁在」。
 *
 * 按内容去重而不是跟着 `tabs` 引用走：Agent 会话的 activity 每 200ms 扫一次屏幕，
 * 终端一刷屏 `tabs` 就是个新数组，但名册内容常常一个字都没变。不去重就是每秒
 * 好几趟无用的 IPC。
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
