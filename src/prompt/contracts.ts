import type { WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";

export interface PromptQueueItem {
  id: string;
  tabId: string;
  text: string;
  createdAt: number;
}

export type PromptSubmitResult = "sent" | "queued" | "unavailable";

export function isAgentKind(kind: WorkspaceTabKind): kind is "codex" | "claude" {
  return kind === "codex" || kind === "claude";
}

export function isPromptBusy(tab: Pick<WorkspaceTab, "activity">) {
  return tab.activity === "talking" || tab.activity === "awaiting-choice";
}

export function canDispatchPrompt(tab: Pick<WorkspaceTab, "kind" | "phase" | "activity">) {
  return isAgentKind(tab.kind) && tab.phase === "running" && tab.activity === "idle";
}
