import { useCallback, useEffect, useRef } from "react";
import type { PromptQueueUpdate, PromptSubmitOptions, PromptSubmitResult } from "../prompt/contracts";
import { claimDelivery, pendingTasks, releaseDelivery, updateDelivery } from "./api";
import { DeliveryCoordinator } from "./delivery";

const POLL_INTERVAL_MS = 750;

/** queued/sent 只是接管，只有 Prompt observer 的 submitted 才能标为已提交。 */
export function shouldMarkDispatched(result: PromptSubmitResult | PromptQueueUpdate["state"]) {
  return result === "submitted";
}

export function useTaskDelivery(submit: (tabId: string, text: string, options?: PromptSubmitOptions) => PromptSubmitResult) {
  const coordinator = useRef(new DeliveryCoordinator());
  const submitRef = useRef(submit);
  submitRef.current = submit;

  useEffect(() => {
    let stopped = false;
    let running = false;
    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        await coordinator.current.tick({
          fetch: pendingTasks, claim: claimDelivery, release: releaseDelivery, receipt: updateDelivery,
          submit: (tabId, text, options) => stopped ? "unavailable" : submitRef.current(tabId, text, options),
        });
      } catch {
        // 下次重试同一个 claim/回执，已接管的内容不再次提交。
      } finally { running = false; }
    };
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  return useCallback((id: string) => coordinator.current.resolvePersisted(id), []);
}
