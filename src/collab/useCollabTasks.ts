import { useCallback, useEffect, useRef, useState } from "react";
import { approveTask, collabTasks, rejectTask, resolveDelivery, stopAllTasks, type TaskView } from "./api";
import type { DeliveryDecision } from "./DeliveryActions";
import { useFeedback, t } from "../i18n";
import { toAppFailure } from "../workspace/errors";

/** 面板刷新间隔。比投递那条（750ms）慢一档：这里只驱动显示。 */
const POLL_INTERVAL_MS = 1_500;

type TaskAction = { kind: "approve" | "reject"; id: string } | { kind: "stopAll" }
  | { kind: "resolve"; id: string; attemptId: string; sequence: number; decision: DeliveryDecision };
export interface TaskActionFailure { action: TaskAction; message: string }
const actionKey = (action: TaskAction) => action.kind === "stopAll" ? "stopAll" : action.id;

export interface CollabTasksView {
  tasks: readonly TaskView[];
  error: string | null;
  queryError: string | null;
  actionErrors: readonly TaskActionFailure[];
  pending: ReadonlySet<string>;
  retry: (action: TaskAction) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  stopAll: () => Promise<void>;
  resolve?: (task: TaskView, decision: DeliveryDecision) => Promise<void>;
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
export function useCollabTasks(onResolved?: (id: string) => void): CollabTasksView {
  const [tasks, setTasks] = useState<readonly TaskView[]>([]);
  const [queryError, setQueryError] = useFeedback<string | null>(null);
  const [actionErrors, setActionErrors] = useState<TaskActionFailure[]>([]);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const reading = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(false);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const resolvedRef = useRef(onResolved);
  resolvedRef.current = onResolved;

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    reading.current = true;
    try {
      const view = await collabTasks();
      if (!mounted.current || request !== generation.current) return;
      setTasks(view.tasks);
      setQueryError(null);
    } catch (cause) {
      if (mounted.current && request === generation.current) setQueryError(() => toAppFailure(cause).message);
    } finally {
      if (request === generation.current) reading.current = false;
    }
  }, []);
  refreshRef.current = refresh;

  useEffect(() => {
    mounted.current = true;
    void refreshRef.current();
    const timer = window.setInterval(() => {
      if (!reading.current && inFlight.current.size === 0) void refreshRef.current();
    }, POLL_INTERVAL_MS);
    return () => { mounted.current = false; generation.current++; window.clearInterval(timer); };
  }, []);

  // 三个动作都紧跟一次刷新：批准完等 1.5 秒才看到状态变，会让人以为没点上。
  const act = useCallback(async (action: TaskAction) => {
    const key = actionKey(action);
    if (!mounted.current || inFlight.current.has(key) || inFlight.current.has("stopAll")
      || (action.kind === "stopAll" && inFlight.current.size > 0)) return;
    inFlight.current.add(key);
    setPending(new Set(inFlight.current));
    generation.current++;
    try {
      if (action.kind === "stopAll") await stopAllTasks();
      else if (action.kind === "approve") await approveTask(action.id);
      else if (action.kind === "resolve") {
        await resolveDelivery({ id: action.id, attemptId: action.attemptId, sequence: action.sequence, decision: action.decision });
        resolvedRef.current?.(action.id);
      }
      else await rejectTask(action.id);
      if (mounted.current) setActionErrors((current) => current.filter((failure) => actionKey(failure.action) !== key));
    } catch (cause) {
      if (mounted.current) setActionErrors((current) => [
        ...current.filter((failure) => actionKey(failure.action) !== key), { action, get message() { return toAppFailure(cause).message; } },
      ]);
    } finally {
      inFlight.current.delete(key);
      if (mounted.current) setPending(new Set(inFlight.current));
    }
    await refreshRef.current();
  }, []);

  return {
    tasks,
    error: actionErrors[0]?.message ?? queryError,
    queryError, actionErrors, pending, retry: act,
    approve: useCallback((id: string) => act({ kind: "approve", id }), [act]),
    reject: useCallback((id: string) => act({ kind: "reject", id }), [act]),
    stopAll: useCallback(() => act({ kind: "stopAll" }), [act]),
    resolve: useCallback((task: TaskView, decision: DeliveryDecision) => {
      if (task.delivery?.phase !== "uncertain" || !task.delivery.attemptId) {
        setActionErrors(current => [...current.filter(failure => actionKey(failure.action) !== task.id), {
          action: { kind: "resolve", id: task.id, attemptId: task.delivery?.attemptId ?? "", sequence: task.delivery?.sequence ?? 0, decision }, get message() { return t("collab.delivery.changed"); },
        }]);
        return refreshRef.current();
      }
      return act({ kind: "resolve", id: task.id, attemptId: task.delivery.attemptId, sequence: task.delivery.sequence, decision });
    }, [act]),
  };
}
