import {
  Check,
  CircleDashed,
  CircleStop,
  RotateCcw,
  SkipForward,
  TriangleAlert,
  X,
} from "lucide-react";
import { ICON } from "../../theme/sizing";
import { recipeStepPreview, type RecipeRun } from "../contracts";
import { recipeBlockedHint, recipeRunStatusLabel, type RecipeRunView } from "../run";

interface RecipeRunCardProps {
  run: RecipeRun;
  view: RecipeRunView;
  targetTitle: string | null;
  onAbort: (runId: string) => void;
  onClear: (runId: string) => void;
  onResend: (runId: string, stepId: string) => void;
  onSkip: (runId: string, stepId: string) => void;
}

/**
 * 一轮的进度。步骤只标「已送达」，不标「已完成」——屏幕文本判不出 Agent 做成了没，
 * 写成完成是在骗人。
 */
export function RecipeRunCard({
  run,
  view,
  targetTitle,
  onAbort,
  onClear,
  onResend,
  onSkip,
}: RecipeRunCardProps) {
  const live = view.status === "running" || view.status === "blocked";

  return (
    <article className="recipe-run" data-status={view.status}>
      <header className="recipe-run__head">
        <div className="recipe-run__title">
          <strong>{run.recipeName}</strong>
          <span>{targetTitle ?? "会话已关闭"}</span>
        </div>
        <span className="recipe-run__badge" data-status={view.status}>
          {recipeRunStatusLabel(view)}
        </span>
        <span className="recipe-run__count">
          {view.dispatchedCount}/{view.steps.length}
        </span>
        {live ? (
          <button
            aria-label="中止这一轮"
            className="icon-button icon-button--sm"
            onClick={() => onAbort(run.id)}
            title="中止这一轮"
            type="button"
          >
            <CircleStop aria-hidden="true" size={ICON.sm} />
          </button>
        ) : (
          <button
            aria-label="移除这条记录"
            className="icon-button icon-button--sm"
            onClick={() => onClear(run.id)}
            title="移除这条记录"
            type="button"
          >
            <X aria-hidden="true" size={ICON.sm} />
          </button>
        )}
      </header>

      {view.blockedReason ? (
        <p className="recipe-run__blocked">
          <TriangleAlert aria-hidden="true" size={ICON.xs} />
          <span>{recipeBlockedHint(view.blockedReason)}</span>
        </p>
      ) : null}

      <ol className="recipe-run__steps">
        {view.steps.map((step, index) => {
          const current = step.stepId === view.currentStepId;
          return (
            <li
              className="recipe-run__step"
              data-current={current || undefined}
              data-status={step.status}
              key={step.stepId}
            >
              <span className="recipe-run__mark" aria-hidden="true">
                {step.status === "dispatched" ? <Check size={ICON.xs} />
                  : step.status === "skipped" ? <SkipForward size={ICON.xs} />
                    : <CircleDashed size={ICON.xs} />}
              </span>
              <span className="recipe-run__index">{index + 1}</span>
              <span className="recipe-run__text" title={step.text}>
                {recipeStepPreview(step.text)}
              </span>
              <span className="recipe-run__step-state">{stepLabel(step.status)}</span>
              <span className="recipe-run__step-actions">
                <button
                  aria-label={`重发第 ${index + 1} 步`}
                  onClick={() => onResend(run.id, step.stepId)}
                  title="重发这一步"
                  type="button"
                >
                  <RotateCcw aria-hidden="true" size={ICON.xs} />
                </button>
                <button
                  aria-label={`跳过第 ${index + 1} 步`}
                  disabled={step.status !== "pending"}
                  onClick={() => onSkip(run.id, step.stepId)}
                  title="跳过这一步"
                  type="button"
                >
                  <SkipForward aria-hidden="true" size={ICON.xs} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </article>
  );
}

function stepLabel(status: RecipeRunView["steps"][number]["status"]) {
  if (status === "dispatched") return "已送达";
  if (status === "skipped") return "已跳过";
  return "待发送";
}
