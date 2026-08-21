import type { PromptQueueItem } from "../prompt/contracts";
import type { SessionActivity, TerminalPhase } from "../terminal/contracts";
import type {
  RecipeBlockedReason,
  RecipeRun,
  RecipeRunStatus,
  RecipeStepStatus,
} from "./contracts";

export interface RecipeRunStepView {
  stepId: string;
  text: string;
  status: RecipeStepStatus;
}

export interface RecipeRunView {
  status: RecipeRunStatus;
  blockedReason: RecipeBlockedReason | null;
  steps: RecipeRunStepView[];
  pendingCount: number;
  dispatchedCount: number;
  skippedCount: number;
  /** 正在等待派发的那一步，供面板高亮和「重发 / 跳过」定位。 */
  currentStepId: string | null;
}

/** 派生只需要会话的这两个字段；传整个 WorkspaceTab 也兼容。 */
export type RecipeRunTarget = {
  phase: TerminalPhase;
  activity: SessionActivity;
};

/**
 * 从 Prompt 队列的现况反推一轮运行走到哪了。
 *
 * 不自己记账「第几步发过了」：队列里还在 = 待发送，不在了 = 已送达。这样终端重挂把未确认的
 * 项回滚进队列时，状态会自动退回待发送——记账的话就得同步处理回滚，很容易漏。
 *
 * `target` 为 null 表示会话已经被关闭，此时队列项已被 PromptQueueRuntime.sync 清空，
 * 剩余步骤发没发已经无从判断，整轮直接算终止，由面板明示「会话已关闭」而不是逐步骤猜。
 */
export function deriveRecipeRun(
  run: RecipeRun,
  queue: readonly PromptQueueItem[],
  target: RecipeRunTarget | null,
): RecipeRunView {
  const skipped = new Set(run.skipped);
  const queued = new Set(
    queue.filter((item) => item.origin?.runId === run.id).map((item) => item.origin?.stepId),
  );

  const steps = run.steps.map((step): RecipeRunStepView => ({
    stepId: step.stepId,
    text: step.text,
    status: stepStatus(step.stepId, skipped, queued, target),
  }));

  const pendingCount = steps.filter((step) => step.status === "pending").length;
  const counts = {
    pendingCount,
    dispatchedCount: steps.filter((step) => step.status === "dispatched").length,
    skippedCount: steps.filter((step) => step.status === "skipped").length,
  };

  return {
    ...counts,
    steps,
    currentStepId: steps.find((step) => step.status === "pending")?.stepId ?? null,
    status: runStatus(run, pendingCount, target),
    blockedReason: blockedReason(pendingCount, target),
  };
}

function stepStatus(
  stepId: string,
  skipped: ReadonlySet<string>,
  queued: ReadonlySet<string | undefined>,
  target: RecipeRunTarget | null,
): RecipeStepStatus {
  if (skipped.has(stepId)) return "skipped";
  if (queued.has(stepId)) return "pending";
  // 会话已关闭：队列被清空过，"不在队列里"不再等于"发出去了"，按未发送呈现更保守。
  return target ? "dispatched" : "pending";
}

function runStatus(
  run: RecipeRun,
  pendingCount: number,
  target: RecipeRunTarget | null,
): RecipeRunStatus {
  if (run.aborted || !target) return "aborted";
  if (pendingCount === 0) return "finished";
  return blockedReason(pendingCount, target) ? "blocked" : "running";
}

function blockedReason(
  pendingCount: number,
  target: RecipeRunTarget | null,
): RecipeBlockedReason | null {
  // 都发完了就没有"卡住"可言，会话随后退出也不该把已完成的轮次标红。
  if (pendingCount === 0) return null;
  if (!target || target.phase === "exited" || target.phase === "error") return "session-gone";
  return target.activity === "awaiting-choice" ? "awaiting-choice" : null;
}

export function recipeRunStatusLabel(view: RecipeRunView) {
  if (view.status === "aborted") return "已中止";
  if (view.status === "finished") return "已全部送达";
  if (view.blockedReason === "session-gone") return "会话已关闭";
  if (view.blockedReason === "awaiting-choice") return "等待确认";
  return "进行中";
}

export function recipeBlockedHint(reason: RecipeBlockedReason) {
  return reason === "awaiting-choice"
    ? "Agent 停在确认框，处理完会自动继续"
    : "目标会话已退出，剩余步骤不会发送";
}
