import { invoke } from "@tauri-apps/api/core";
import type { ContextItem, ContextKind, ContextSource } from "./contracts";

/** 写入请求。正文单独给，由 Rust 侧决定内联还是落盘。 */
export interface ContextWrite {
  id: string;
  kind: ContextKind;
  title: string;
  body: string;
  source: ContextSource;
  tags: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export function listContext(rootPath: string) {
  return invoke<ContextItem[]>("context_list", { rootPath });
}

export function putContext(rootPath: string, write: ContextWrite) {
  return invoke<ContextItem>("context_put", { rootPath, write });
}

/** 取正文。内联的从索引拿，落盘的读文件——调用方不必关心它存在哪。 */
export function getContextBody(rootPath: string, id: string) {
  return invoke<string>("context_get", { rootPath, id });
}

export function removeContext(rootPath: string, id: string) {
  return invoke<void>("context_remove", { rootPath, id });
}

/** 只翻元数据。落盘条目的正文不必读回内存，所以不走 put。 */
export function setContextPinned(rootPath: string, id: string, pinned: boolean) {
  return invoke<ContextItem>("context_set_pinned", { rootPath, id, pinned });
}

/** 一条会话在名册里的样子。字段与 Rust 侧 SessionSnapshot 一一对应。 */
export interface CollabSessionSnapshot {
  tabId: string;
  title: string;
  agent: string;
  activity: string;
  /** 能不能收指令。前端算好，Rust 侧原样转发。 */
  canReceive: boolean;
  /** 会话的项目根，供派活判断是不是同项目。不会转发给别的 Agent。 */
  projectRoot: string;
}

/** 把会话名册推给 Rust，供控制 CLI 的 `belfry peers` 回答。 */
export function syncCollabSessions(sessions: CollabSessionSnapshot[]) {
  return invoke<void>("collab_sync_sessions", { sessions });
}

/** 一条等着投进目标终端的协作任务。 */
export interface PendingTask {
  id: string;
  /** 注入文本，三行协议头已拼好。 */
  text: string;
  to: string;
  from: string;
  fromLabel: string;
  instruction: string;
}

/** 取待投递任务。拉而不是推：只有前端知道终端目标注册好了没。 */
export function listPendingTasks() {
  return invoke<PendingTask[]>("collab_pending_tasks");
}

/** 投递完回执，免得下一轮又取到同一条。 */
export function markTaskDispatched(id: string) {
  return invoke<void>("collab_mark_dispatched", { id });
}
