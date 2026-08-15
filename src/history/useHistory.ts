import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKind, AppFailure } from "../workspace/contracts";
import { toAppFailure } from "../workspace/errors";
import { clearHistory, deleteHistorySession, listHistory } from "./api";
import type { HistorySession } from "./contracts";

/** 历史会话面板的数据层：按 Agent 加载列表，删除单条，清空全部。 */
export function useHistory(enabled: boolean) {
  const [agent, setAgent] = useState<AgentKind>("codex");
  const [sessions, setSessions] = useState<HistorySession[]>([]);
  const [loading, setLoading] = useState(false);
  /** 正在删除的会话 id；用于禁用该行的按钮，防止连点。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [failure, setFailure] = useState<AppFailure | null>(null);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setFailure(null);
    try {
      const next = await listHistory(agent);
      // 丢弃过期响应：切换 Agent 时旧请求可能后到。
      if (version !== requestVersion.current) return;
      setSessions(next);
    } catch (error) {
      if (version === requestVersion.current) setFailure(toAppFailure(error));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [agent]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  const removeOne = useCallback(async (sessionId: string) => {
    setBusyId(sessionId);
    setFailure(null);
    try {
      await deleteHistorySession(agent, sessionId);
      setSessions((current) => current.filter((session) => session.id !== sessionId));
    } catch (error) {
      setFailure(toAppFailure(error));
    } finally {
      setBusyId(null);
    }
  }, [agent]);

  const clearAll = useCallback(async () => {
    setClearing(true);
    setFailure(null);
    try {
      await clearHistory(agent);
      setSessions([]);
    } catch (error) {
      setFailure(toAppFailure(error));
    } finally {
      setClearing(false);
    }
  }, [agent]);

  /** 批量删除：逐条删后端文件，列表统一过滤；中途失败就重扫一次对齐实际状态。 */
  const removeMany = useCallback(async (sessionIds: string[]) => {
    const ids = new Set(sessionIds);
    setClearing(true);
    setFailure(null);
    try {
      for (const id of ids) {
        await deleteHistorySession(agent, id);
      }
      setSessions((current) => current.filter((session) => !ids.has(session.id)));
    } catch (error) {
      setFailure(toAppFailure(error));
      await load();
    } finally {
      setClearing(false);
    }
  }, [agent, load]);

  return {
    agent,
    setAgent,
    sessions,
    loading,
    busyId,
    clearing,
    failure,
    reload: load,
    removeOne,
    removeMany,
    clearAll,
  };
}
