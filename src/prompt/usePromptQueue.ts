import { useCallback, useEffect, useRef } from "react";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import type { PromptSubmitResult } from "./contracts";
import { PromptQueueRuntime } from "./runtime";

interface PromptQueueOptions {
  tabs: readonly WorkspaceTab[];
  targets: ReadonlyMap<string, TerminalCommandTarget>;
}

/** 协作任务使用的后台队列；只在应用内存中存活。 */
export function usePromptQueue({ tabs, targets }: PromptQueueOptions) {
  const runtime = useRef(new PromptQueueRuntime());
  const submit = useCallback((tabId: string, text: string): PromptSubmitResult => {
    return runtime.current.submit(tabs, targets, tabId, text);
  }, [tabs, targets]);

  useEffect(() => {
    const sync = () => runtime.current.sync(tabs, targets);
    sync();
    const timer = window.setInterval(sync, 1_000);
    return () => window.clearInterval(timer);
  }, [tabs, targets]);

  return { submit };
}
