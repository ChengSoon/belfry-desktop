import { useCallback, useEffect, useRef } from "react";
import type { PromptRunStep } from "../prompt/runtime";
import { listPendingTasks, markTaskDispatched } from "./api";

interface CollabTasksOptions {
  /** 目标终端已注册的会话 id。没注册的先不投，等它就绪。 */
  readyTabIds: ReadonlySet<string>;
  enqueueRun: (
    tabId: string,
    steps: readonly PromptRunStep[],
    runId: string,
    position?: "head" | "tail",
    kind?: "recipe" | "collab",
  ) => number;
}

/** 没有待投递任务时的空转间隔。 */
const POLL_INTERVAL_MS = 1200;

/**
 * 把别的会话派来的任务投进 Prompt 队列。
 *
 * 拉而不是等 Rust 推：只有这里知道终端目标注册好了没——targets 表在前端手上，
 * 而 PTY 重挂期间目标会短暂消失。投早了会丢，投晚了只是慢一拍。
 *
 * 投进队列之后就不再管了：串行、等 `running + idle`、权限框自然暂停、
 * 终端重挂回滚，全是队列的既有语义。派活不需要第二个执行引擎。
 */
export function useCollabTasks({ readyTabIds, enqueueRun }: CollabTasksOptions) {
  // 放进 ref：轮询定时器不该因为这两个每帧都变的值重建。
  const readyRef = useRef(readyTabIds);
  const enqueueRef = useRef(enqueueRun);
  readyRef.current = readyTabIds;
  enqueueRef.current = enqueueRun;

  const drain = useCallback(async () => {
    let pending;
    try {
      pending = await listPendingTasks();
    } catch {
      // 服务没起来或调用失败：下一轮再试，不打扰用户——
      // 协作是增强功能，它不通不该在界面上刷错误。
      return;
    }
    for (const task of pending) {
      if (!readyRef.current.has(task.to)) continue;
      const queued = enqueueRef.current(
        task.to,
        [{ stepId: task.id, text: task.text }],
        task.id,
        "tail",
        "collab",
      );
      // 入队失败（目标已退出/不是 Agent）就别回执，让它留在待投队列里，
      // 由会话关闭时的收尾逻辑标成 abandoned——比在这里悄悄丢掉强。
      if (queued > 0) await markTaskDispatched(task.id).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      await drain();
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [drain]);
}
