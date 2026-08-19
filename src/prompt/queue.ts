import type { PromptQueueItem } from "./contracts";

export function createPromptQueueItem(tabId: string, text: string, now = Date.now()): PromptQueueItem {
  return { id: crypto.randomUUID(), tabId, text, createdAt: now };
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
