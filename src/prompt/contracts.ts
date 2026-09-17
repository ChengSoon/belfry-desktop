import type { WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";
import type { AgentKind } from "../agent/contracts";

export interface PromptQueueItem {
  id: string;
  tabId: string;
  text: string;
  createdAt: number;
}

export type PromptSubmitResult = "sent" | "queued" | "unavailable";

export function isAgentKind(kind: WorkspaceTabKind): kind is AgentKind {
  return kind === "codex" || kind === "claude" || kind === "pi";
}

export function isPromptBusy(tab: Pick<WorkspaceTab, "activity">) {
  return tab.activity === "talking" || tab.activity === "awaiting-choice";
}

export function canDispatchPrompt(tab: Pick<WorkspaceTab, "kind" | "phase" | "activity">) {
  return isAgentKind(tab.kind) && tab.phase === "running" && tab.activity === "idle";
}
