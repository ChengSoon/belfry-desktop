import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { type PromptSubmitResult } from "./contracts";
import { PromptQueueRuntime, type PromptRunStep } from "./runtime";

interface PromptQueueOptions {
  tabs: readonly WorkspaceTab[];
  targets: ReadonlyMap<string, TerminalCommandTarget>;
}

/** 将可测试的队列运行时接到 React 状态；队列只在应用内存中存活。 */
export function usePromptQueue({ tabs, targets }: PromptQueueOptions) {
  const runtime = useRef(new PromptQueueRuntime());
  const [items, setItems] = useState(() => [...runtime.current.items]);
  const publish = useCallback(() => setItems([...runtime.current.items]), []);

  const submit = useCallback((tabId: string, text: string): PromptSubmitResult => {
    const result = runtime.current.submit(tabs, targets, tabId, text);
    publish();
    return result;
  }, [publish, tabs, targets]);

  const remove = useCallback((id: string) => {
    runtime.current.remove(id);
    publish();
  }, [publish]);

  const sendNow = useCallback((tabId: string) => {
    const sent = runtime.current.sendNow(tabs, targets, tabId);
    publish();
    return sent;
  }, [publish, tabs, targets]);

  const enqueueRun = useCallback((
    tabId: string,
    steps: readonly PromptRunStep[],
    runId: string,
    position: "head" | "tail" = "tail",
  ) => {
    const queued = runtime.current.enqueueRun(tabs, targets, tabId, steps, runId, position);
    publish();
    return queued;
  }, [publish, tabs, targets]);

  const removeRun = useCallback((runId: string) => {
    runtime.current.removeRun(runId);
    publish();
  }, [publish]);

  useEffect(() => {
    runtime.current.sync(tabs, targets);
    publish();
  }, [publish, tabs, targets]);

  return { enqueueRun, items, remove, removeRun, sendNow, submit };
}
