import { Copy, ListChecks, Play, Plus, SquarePen, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { isAgentKind } from "../prompt/contracts";
import type { PromptQueueItem } from "../prompt/contracts";
import { ICON } from "../theme/sizing";
import type { WorkspaceTab } from "../workspace/contracts";
import { useDismiss } from "../workspace/useDismiss";
import { RecipeEditor } from "./components/RecipeEditor";
import { RecipeLauncher, RecipeLauncherHeader } from "./components/RecipeLauncher";
import { RecipeRunCard } from "./components/RecipeRunCard";
import { recipeStepPreview, recipeVariables, type Recipe, type RecipeRun } from "./contracts";
import { deriveRecipeRun } from "./run";
import "./recipePanel.css";

type RecipeView =
  | { kind: "list" }
  | { kind: "edit"; recipe: Recipe }
  | { kind: "run"; recipe: Recipe };

interface RecipePanelProps {
  activeTabId: string | null;
  queueItems: readonly PromptQueueItem[];
  recipes: readonly Recipe[];
  runs: readonly RecipeRun[];
  shortcutLabel: string;
  tabs: readonly WorkspaceTab[];
  onAbortRun: (runId: string) => void;
  onClearRun: (runId: string) => void;
  onClose: () => void;
  onDraft: () => Recipe;
  onDuplicate: (id: string) => void;
  onRemoveRecipe: (id: string) => void;
  onResendStep: (runId: string, stepId: string) => void;
  onSaveRecipe: (recipe: Recipe) => void;
  onSkipStep: (runId: string, stepId: string) => void;
  onStartRun: (recipe: Recipe, tabId: string, values: Record<string, string>) => void;
}

export function RecipePanel({
  activeTabId,
  queueItems,
  recipes,
  runs,
  shortcutLabel,
  tabs,
  onAbortRun,
  onClearRun,
  onClose,
  onDraft,
  onDuplicate,
  onRemoveRecipe,
  onResendStep,
  onSaveRecipe,
  onSkipStep,
  onStartRun,
}: RecipePanelProps) {
  const [view, setView] = useState<RecipeView>({ kind: "list" });
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const agentTabs = useMemo(() => tabs.filter((tab) => isAgentKind(tab.kind)), [tabs]);
  const tabsById = useMemo(() => new Map(tabs.map((tab) => [tab.id, tab])), [tabs]);
  // 编辑 / 启动视图里有输入框，点外面关掉整个面板会吞掉正在填的内容。
  const panelRef = useDismiss<HTMLDivElement>(view.kind === "list", onClose);

  return (
    <div
      aria-label="Recipe"
      className="recipe-panel"
      ref={panelRef}
      role="region"
    >
      <header className="recipe-panel__head">
        <span className="recipe-panel__mark" aria-hidden="true">
          <ListChecks size={ICON.md} />
        </span>
        <div className="recipe-panel__title">
          <strong>Recipe</strong>
          <span>{recipes.length > 0 ? `${recipes.length} 条可复用指令` : "还没有保存的指令"}</span>
        </div>
        {view.kind === "list" ? (
          <button
            className="recipe-button"
            onClick={() => setView({ kind: "edit", recipe: onDraft() })}
            type="button"
          >
            <Plus aria-hidden="true" size={ICON.xs} />
            <span>新建</span>
          </button>
        ) : null}
        <button
          aria-label="关闭 Recipe"
          className="icon-button icon-button--sm"
          onClick={onClose}
          title="关闭"
          type="button"
        >
          <X aria-hidden="true" size={ICON.md} />
        </button>
      </header>

      {view.kind === "edit" ? (
        <>
          <RecipeLauncherHeader
            name={recipes.some((item) => item.id === view.recipe.id) ? "编辑 Recipe" : "新建 Recipe"}
            onClose={() => setView({ kind: "list" })}
          />
          <RecipeEditor
            onCancel={() => setView({ kind: "list" })}
            onSave={(recipe) => {
              onSaveRecipe(recipe);
              setView({ kind: "list" });
            }}
            recipe={view.recipe}
          />
        </>
      ) : null}

      {view.kind === "run" ? (
        <>
          <RecipeLauncherHeader name={view.recipe.name} onClose={() => setView({ kind: "list" })} />
          <RecipeLauncher
            agentTabs={agentTabs}
            initialTabId={activeTabId}
            onCancel={() => setView({ kind: "list" })}
            onStart={(tabId, values) => {
              onStartRun(view.recipe, tabId, values);
              setView({ kind: "list" });
            }}
            recipe={view.recipe}
          />
        </>
      ) : null}

      {view.kind === "list" ? (
        <div className="recipe-panel__body">
          {recipes.length === 0 ? (
            <p className="recipe-panel__empty">
              把反复要敲的多步指令存成 Recipe，之后挑一个 Agent 会话按顺序发出去。
            </p>
          ) : (
            <ul className="recipe-list">
              {recipes.map((recipe) => {
                const variables = recipeVariables(recipe.steps);
                return (
                  <li className="recipe-list__item" key={recipe.id}>
                    <div className="recipe-list__copy">
                      <strong>{recipe.name}</strong>
                      <small>
                        {recipe.steps.length} 步
                        {variables.length > 0 ? ` · ${variables.length} 个变量` : ""}
                        {recipe.description ? ` · ${recipeStepPreview(recipe.description, 40)}` : ""}
                      </small>
                    </div>
                    {pendingRemove === recipe.id ? (
                      <span className="recipe-list__confirm">
                        <span>删除？</span>
                        <button
                          className="recipe-button recipe-button--danger"
                          onClick={() => {
                            onRemoveRecipe(recipe.id);
                            setPendingRemove(null);
                          }}
                          type="button"
                        >
                          删除
                        </button>
                        <button
                          className="recipe-button"
                          onClick={() => setPendingRemove(null)}
                          type="button"
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <span className="recipe-list__actions">
                        <button
                          aria-label={`运行 ${recipe.name}`}
                          disabled={agentTabs.length === 0}
                          onClick={() => setView({ kind: "run", recipe })}
                          title={agentTabs.length === 0 ? "先打开 Agent 会话" : "运行"}
                          type="button"
                        >
                          <Play aria-hidden="true" size={ICON.xs} />
                        </button>
                        <button
                          aria-label={`编辑 ${recipe.name}`}
                          onClick={() => setView({ kind: "edit", recipe })}
                          title="编辑"
                          type="button"
                        >
                          <SquarePen aria-hidden="true" size={ICON.xs} />
                        </button>
                        <button
                          aria-label={`复制 ${recipe.name}`}
                          onClick={() => onDuplicate(recipe.id)}
                          title="复制一份"
                          type="button"
                        >
                          <Copy aria-hidden="true" size={ICON.xs} />
                        </button>
                        <button
                          aria-label={`删除 ${recipe.name}`}
                          onClick={() => setPendingRemove(recipe.id)}
                          title="删除"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" size={ICON.xs} />
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {runs.length > 0 ? (
            <div className="recipe-panel__runs">
              <div className="recipe-panel__runs-head">
                <span>运行记录</span>
                <small>本次运行内有效</small>
              </div>
              {runs.map((run) => (
                <RecipeRunCard
                  key={run.id}
                  onAbort={onAbortRun}
                  onClear={onClearRun}
                  onResend={onResendStep}
                  onSkip={onSkipStep}
                  run={run}
                  targetTitle={tabsById.get(run.tabId)?.title ?? null}
                  view={deriveRecipeRun(run, queueItems, tabsById.get(run.tabId) ?? null)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <footer className="recipe-panel__foot">
        <span>步骤只标「已送达」，Agent 是否照做需自行确认</span>
        <span>{shortcutLabel}</span>
      </footer>
    </div>
  );
}
