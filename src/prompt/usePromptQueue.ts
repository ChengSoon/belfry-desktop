import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalCommandTarget } from "../terminal/contracts";
import type { WorkspaceTab } from "../workspace/contracts";
import { type PromptSubmitResult } from "./contracts";
import { PromptQueueRuntime } from "./runtime";

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

  useEffect(() => {
    runtime.current.sync(tabs, targets);
    publish();
  }, [publish, tabs, targets]);

  return { items, remove, sendNow, submit };
}
