import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import type { PromptSubmitOptions, PromptSubmitResult } from "./contracts";
import { PromptQueueRuntime, type PausedDelivery } from "./runtime";

interface PromptQueueOptions {
  tabs: readonly WorkspaceTab[];
  targets: ReadonlyMap<string, TerminalCommandTarget>;
}

/** 协作任务与宿主反馈共用的后台队列；只在应用内存中存活。 */
export function usePromptQueue({ tabs, targets }: PromptQueueOptions) {
  const runtime = useRef(new PromptQueueRuntime());
  const submit = useCallback((tabId: string, text: string, options?: PromptSubmitOptions): PromptSubmitResult => {
    return runtime.current.submit(tabs, targets, tabId, text, options);
  }, [tabs, targets]);
  const cancel = useCallback((id: string) => runtime.current.cancel(id), []);
  const [paused, setPaused] = useState<readonly PausedDelivery[]>([]);
  const publish = useCallback(() => {
    const next = runtime.current.pausedDeliveries();
    setPaused((current) => sameDeliveries(current, next) ? current : next);
  }, []);
  const resume = useCallback((tabId: string) => {
    const resumed = runtime.current.resume(tabId);
    publish();
    return resumed;
  }, [publish]);
  const resolvePersisted = useCallback((id: string) => { runtime.current.resolvePersisted(id); publish(); }, [publish]);

  useEffect(() => {
    const sync = () => { runtime.current.sync(tabs, targets); publish(); };
    sync();
    const timer = window.setInterval(sync, 1_000);
    return () => window.clearInterval(timer);
  }, [tabs, targets]);

  const isEmptyFor = useCallback((tabId: string) => runtime.current.isEmptyFor(tabId), []);

  return { submit, cancel, paused, resume, resolvePersisted, isEmptyFor };
}

function sameDeliveries(a: readonly PausedDelivery[], b: readonly PausedDelivery[]) {
  return a.length === b.length && a.every((item, at) => item.tabId === b[at].tabId && item.message === b[at].message);
}
