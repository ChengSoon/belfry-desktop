import type { SessionActivity, TerminalPhase } from "../terminal/contracts";
import type { WorkspaceTab, WorkspaceTabKind } from "../workspace/contracts";

export interface PromptQueueItem {
  id: string;
  tabId: string;
  text: string;
  createdAt: number;
}

export type PromptSubmitResult = "sent" | "queued" | "unavailable";

export interface PromptTargetTab {
  id: string;
  title: string;
  kind: WorkspaceTabKind;
  phase: TerminalPhase;
  activity: SessionActivity;
}

export function isAgentKind(kind: WorkspaceTabKind): kind is "codex" | "claude" {
  return kind === "codex" || kind === "claude";
}

export function isPromptBusy(tab: Pick<PromptTargetTab, "activity">) {
  return tab.activity === "talking" || tab.activity === "awaiting-choice";
}

export function canDispatchPrompt(tab: Pick<PromptTargetTab, "kind" | "phase" | "activity">) {
  return isAgentKind(tab.kind) && tab.phase === "running" && tab.activity === "idle";
}

export function toPromptTarget(tab: WorkspaceTab): PromptTargetTab {
  return {
    id: tab.id,
    title: tab.title,
    kind: tab.kind,
    phase: tab.phase,
    activity: tab.activity,
  };
}

export function promptPreview(text: string, maxLength = 88) {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

export function promptTargetLabel(kind: WorkspaceTabKind) {
  return kind === "codex" ? "Codex" : kind === "claude" ? "Claude" : "终端";
}
