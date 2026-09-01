import { useCallback, useEffect, useRef, useState } from "react";
import { approveTask, collabTasks, rejectTask, stopAllTasks, type TaskView } from "./api";

/** 面板刷新间隔。比投递那条（750ms）慢一档：这里只驱动显示。 */
const POLL_INTERVAL_MS = 1_500;

export interface CollabTasksView {
  tasks: readonly TaskView[];
  error: string | null;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
}

/**
 * 协作任务的只读视图 + 三个动作。
 *
 * 面板关着也照样轮询：等确认的派活卡着整条链，用户得能在触发按钮上看见角标，
 * 否则 Agent 派了活、人没注意，任务就一直悬在那儿谁也不知道。
 *
 * 定时器不进 effect 依赖：动作会触发一次立即刷新，而刷新会改 state，
 * 挂上去就变成每次刷新都重建一遍定时器。
 */
export function useCollabTasks(): CollabTasksView {
  const [tasks, setTasks] = useState<readonly TaskView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  const refresh = useCallback(async () => {
    try {
      const view = await collabTasks();
      setTasks(view.tasks);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    const timer = window.setInterval(() => void refreshRef.current(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  // 三个动作都紧跟一次刷新：批准完等 1.5 秒才看到状态变，会让人以为没点上。
  const act = useCallback(async (run: () => Promise<unknown>) => {
    try {
      await run();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
    await refreshRef.current();
  }, []);

  return {
    tasks,
    error,
    approve: useCallback((id: string) => act(() => approveTask(id)), [act]),
    reject: useCallback((id: string) => act(() => rejectTask(id)), [act]),
    stopAll: useCallback(() => act(stopAllTasks), [act]),
  };
}
