import type { WorkspaceTab } from "../workspace/contracts";
import { isAgentKind } from "../agent/contracts";
export { isAgentKind } from "../agent/contracts";

export interface PromptQueueItem {
  id: string;
  tabId: string;
  text: string;
  createdAt: number;
}

export type PromptSubmitResult = "sent" | "queued" | "unavailable";

export interface PromptQueueUpdate {
  state: "queued" | "sending" | "submitted" | "attention" | "cancelled";
  message?: string;
}

export interface PromptSubmitOptions {
  id?: string;
  /** 宿主发起的反馈只能投递给仍属于这个项目的会话。 */
  projectRoot?: string;
  onUpdate?: (update: PromptQueueUpdate) => void;
  /** 写入 PTY 前必须成功持久化提交意图；false 表示已取消，拒绝表示可以安全重试。 */
  beforeSend?: () => Promise<boolean>;
}

export function isPromptBusy(tab: Pick<WorkspaceTab, "activity">) {
  return tab.activity === "talking" || tab.activity === "awaiting-choice";
}

export function canDispatchPrompt(tab: Pick<WorkspaceTab, "kind" | "phase" | "activity">) {
  return isAgentKind(tab.kind) && tab.phase === "running" && tab.activity === "idle";
}
