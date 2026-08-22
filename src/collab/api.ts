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
