import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectWorkspace } from "../workspace/contracts";
import { listContext, putContext, removeContext, setContextPinned, type ContextWrite } from "./api";
import {
  createContextItem,
  type ContextItem,
  type ContextKind,
  type ContextSource,
} from "./contracts";

interface SharedContextOptions {
  project: ProjectWorkspace | null;
}

/**
 * 共享上下文的数据层。
 *
 * 索引存在项目里，所以整份数据随项目切换而换。切项目时旧请求可能后到，
 * 用单调递增的 requestVersion 丢弃过期结果——和 history 那边同一个套路。
 */
export function useSharedContext({ project }: SharedContextOptions) {
  const [items, setItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const rootPath = project?.rootPath ?? null;

  const reload = useCallback(async () => {
    if (!rootPath) {
      requestVersion.current += 1;
      setItems([]);
      setFailure(null);
      return;
    }
    const version = (requestVersion.current += 1);
    setLoading(true);
    try {
      const next = await listContext(rootPath);
      if (version !== requestVersion.current) return;
      setItems(next);
      setFailure(null);
    } catch (error) {
      if (version !== requestVersion.current) return;
      setItems([]);
      setFailure(errorMessage(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [rootPath]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** 加一条。正文长短由 Rust 侧决定内联还是落盘，这里不操心。 */
  const add = useCallback(async (input: {
    kind: ContextKind;
    title: string;
    body: string;
    source: ContextSource;
    tags?: readonly string[];
  }) => {
    if (!rootPath) return null;
    if (input.body.trim().length === 0) return null;
    const draft = createContextItem(input);
    const write: ContextWrite = {
      id: draft.id,
      kind: draft.kind,
      title: draft.title,
      body: input.body,
      source: draft.source,
      tags: draft.tags,
      pinned: draft.pinned,
      createdAt: draft.createdAt,
      updatedAt: draft.updatedAt,
    };
    try {
      const saved = await putContext(rootPath, write);
      // 服务端回的才是权威版本：它知道正文最终落在 body 还是 path。
      setItems((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setFailure(null);
      return saved;
    } catch (error) {
      setFailure(errorMessage(error));
      return null;
    }
  }, [rootPath]);

  const remove = useCallback(async (id: string) => {
    if (!rootPath) return;
    const snapshot = items;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      await removeContext(rootPath, id);
    } catch (error) {
      // 删失败就把列表放回去，不然 UI 显示删掉了而磁盘上还在。
      setItems(snapshot);
      setFailure(errorMessage(error));
    }
  }, [items, rootPath]);

  const togglePin = useCallback(async (id: string) => {
    if (!rootPath) return;
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    try {
      // 走只改元数据的通道：落盘条目的正文不必读进内存再写回。
      const saved = await setContextPinned(rootPath, id, !item.pinned);
      setItems((current) => current.map((entry) => (entry.id === saved.id ? saved : entry)));
      setFailure(null);
    } catch (error) {
      setFailure(errorMessage(error));
    }
  }, [items, rootPath]);

  return { add, failure, items, loading, reload, remove, togglePin };
}

function errorMessage(error: unknown) {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "共享上下文操作失败";
}
