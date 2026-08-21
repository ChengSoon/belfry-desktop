import type { PromptOrigin, PromptQueueItem } from "./contracts";

export function createPromptQueueItem(
  tabId: string,
  text: string,
  now = Date.now(),
  origin: PromptOrigin | null = null,
): PromptQueueItem {
  return { id: crypto.randomUUID(), tabId, text, createdAt: now, origin };
}

export function nextPrompt(items: readonly PromptQueueItem[], tabId: string) {
  return items.find((item) => item.tabId === tabId) ?? null;
}

export function removePrompt(items: readonly PromptQueueItem[], id: string) {
  const next = items.filter((item) => item.id !== id);
  return next.length === items.length ? [...items] : next;
}

export function removePromptsForTab(items: readonly PromptQueueItem[], tabId: string) {
  return items.filter((item) => item.tabId !== tabId);
}

/** 中止一轮 Recipe：只清掉还没派发的那些步骤，已经交给终端的管不了。 */
export function removePromptsForRun(items: readonly PromptQueueItem[], runId: string) {
  return items.filter((item) => item.origin?.runId !== runId);
}

export function promptsForRun(items: readonly PromptQueueItem[], runId: string) {
  return items.filter((item) => item.origin?.runId === runId);
}
