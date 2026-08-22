import { useCallback, useEffect, useState } from "react";
import {
  approveTask,
  listCollabTasks,
  rejectTask,
  stopAllTasks,
  type TaskView,
} from "./api";

/** 和投递轮询同一个节奏：面板上的状态不该比实际慢太多。 */
const POLL_INTERVAL_MS = 1200;

/**
 * 协作任务的读侧。
 *
 * 轮询而不是订阅：任务状态由 CLI（另一个进程）改，Rust 侧没有现成的事件通道，
 * 而这份数据撑死几十条，1.2 秒一轮的代价可以忽略。
 */
export function useCollabTaskBoard() {
  const [tasks, setTasks] = useState<TaskView[]>([]);

  const reload = useCallback(async () => {
    try {
      const view = await listCollabTasks();
      setTasks(view.tasks);
    } catch {
      // 协作服务没起来时不该在界面上刷错误——它是增强功能。
      setTasks([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => void reload(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  // 三个操作都立刻重拉：用户点完要马上看到结果，等下一轮轮询会显得没反应。
  const approve = useCallback(async (id: string) => {
    await approveTask(id).catch(() => undefined);
    await reload();
  }, [reload]);

  const reject = useCallback(async (id: string) => {
    await rejectTask(id).catch(() => undefined);
    await reload();
  }, [reload]);

  const stopAll = useCallback(async () => {
    const stopped = await stopAllTasks().catch(() => 0);
    await reload();
    return stopped;
  }, [reload]);

  const pendingApproval = tasks.filter((task) => task.state === "pendingApproval");
  const active = tasks.filter(
    (task) => task.state === "queued" || task.state === "dispatched",
  );

  return { active, approve, pendingApproval, reject, reload, stopAll, tasks };
}
