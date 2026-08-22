import { useEffect } from "react";
import { isAgentKind } from "../prompt/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { syncCollabSessions, type CollabSessionSnapshot } from "./api";

/**
 * 把会话名册同步给 Rust。
 *
 * 会话状态只活在前端，而控制 CLI 是从 PTY 里连进来问「现在有谁在」的，
 * 那时前端不在调用栈上——只能靠这份推过去的快照。
 *
 * `canReceive` 在这里算完再送过去，Rust 侧原样转发不重新推导：一旦两边各自
 * 判断，迟早出现「UI 说能派活、CLI 说不能」的分歧。
 */
export function useCollabSessions(tabs: readonly WorkspaceTab[]) {
  // 只喂 Rust 需要的那几个字段，且只在它们真的变了时才发。
  // 直接依赖 tabs 会让每次 activity 抖动都打一次 IPC。
  const digest = JSON.stringify(tabs.map(toSnapshot));

  useEffect(() => {
    void syncCollabSessions(JSON.parse(digest) as CollabSessionSnapshot[]);
  }, [digest]);
}

function toSnapshot(tab: WorkspaceTab): CollabSessionSnapshot {
  return {
    tabId: tab.id,
    title: tab.title,
    // Shell / SSH 也进名册：Agent 该看得见有这么一条会话在，
    // 只是 canReceive 为 false——看得见但派不了活。
    agent: tab.kind,
    activity: tab.activity,
    canReceive: isAgentKind(tab.kind) && tab.phase === "running",
    // 派活的同项目判断读它。会话自带项目归属，不同会话可以指向不同目录。
    projectRoot: tab.project.rootPath,
  };
}
