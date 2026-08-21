import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PromptQueueItem } from "../prompt/contracts";
import type { PromptRunStep } from "../prompt/runtime";
import type { WorkspaceTab } from "../workspace/contracts";
import {
  buildRunSteps,
  createRecipe,
  type Recipe,
  type RecipeRun,
} from "./contracts";
import { loadRecipes, saveRecipes } from "./storage";

/** 内存里留几轮记录够回看就行；运行记录本来就不跨应用重启。 */
const RUN_HISTORY_LIMIT = 8;

interface RecipesOptions {
  queueItems: readonly PromptQueueItem[];
  tabs: readonly WorkspaceTab[];
  enqueueRun: (
    tabId: string,
    steps: readonly PromptRunStep[],
    runId: string,
    position?: "head" | "tail",
  ) => number;
  removePrompt: (id: string) => void;
  removeRun: (runId: string) => void;
}

export function useRecipes({
  queueItems,
  tabs,
  enqueueRun,
  removePrompt,
  removeRun,
}: RecipesOptions) {
  const [recipes, setRecipes] = useState<Recipe[]>(() => loadRecipes());
  const [runs, setRuns] = useState<RecipeRun[]>([]);
  const loaded = useRef(false);

  // 首帧不回写：挂载时刚读出来的内容原样存一遍没意义，还会在 localStorage 被禁用时白报错。
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true;
      return;
    }
    saveRecipes(recipes);
  }, [recipes]);

  const saveRecipe = useCallback((recipe: Recipe) => {
    setRecipes((current) => {
      const next = { ...recipe, updatedAt: Date.now() };
      const index = current.findIndex((item) => item.id === recipe.id);
      if (index < 0) return [next, ...current];
      return current.map((item) => (item.id === recipe.id ? next : item));
    });
  }, []);

  const removeRecipe = useCallback((id: string) => {
    setRecipes((current) => current.filter((item) => item.id !== id));
  }, []);

  const duplicateRecipe = useCallback((id: string) => {
    setRecipes((current) => {
      const source = current.find((item) => item.id === id);
      if (!source) return current;
      const now = Date.now();
      const copy: Recipe = {
        ...source,
        id: crypto.randomUUID(),
        name: `${source.name} 副本`.slice(0, 60),
        steps: source.steps.map((step) => ({ ...step, id: crypto.randomUUID() })),
        createdAt: now,
        updatedAt: now,
      };
      return [copy, ...current];
    });
  }, []);

  const draft = useCallback(() => createRecipe(), []);

  /** 启动一轮：把替换完变量的步骤一次交给 Prompt 队列，后续派发由队列的既有语义负责。 */
  const startRun = useCallback((
    recipe: Recipe,
    tabId: string,
    values: Readonly<Record<string, string>>,
  ): RecipeRun | null => {
    const steps = buildRunSteps(recipe, values);
    if (steps.length === 0) return null;

    const run: RecipeRun = {
      id: crypto.randomUUID(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      tabId,
      steps,
      startedAt: Date.now(),
      aborted: false,
      skipped: [],
    };
    const queued = enqueueRun(tabId, steps, run.id);
    if (queued === 0) return null;

    setRuns((current) => [run, ...current].slice(0, RUN_HISTORY_LIMIT));
    return run;
  }, [enqueueRun]);

  const abortRun = useCallback((runId: string) => {
    removeRun(runId);
    setRuns((current) => current.map(
      (run) => (run.id === runId ? { ...run, aborted: true } : run),
    ));
  }, [removeRun]);

  /** 跳过一步：从队列里摘掉它，下一步自然顶上。 */
  const skipStep = useCallback((runId: string, stepId: string) => {
    const item = queueItems.find(
      (candidate) => candidate.origin?.runId === runId && candidate.origin.stepId === stepId,
    );
    if (item) removePrompt(item.id);
    setRuns((current) => current.map((run) => (
      run.id === runId && !run.skipped.includes(stepId)
        ? { ...run, skipped: [...run.skipped, stepId] }
        : run
    )));
  }, [queueItems, removePrompt]);

  /** 重发一步：插到队首，下一次派发优先取它；同时撤掉可能存在的跳过标记。 */
  const resendStep = useCallback((runId: string, stepId: string) => {
    const run = runs.find((candidate) => candidate.id === runId);
    const step = run?.steps.find((candidate) => candidate.stepId === stepId);
    if (!run || !step) return false;

    const queued = enqueueRun(run.tabId, [step], run.id, "head");
    if (queued === 0) return false;
    setRuns((current) => current.map((candidate) => (
      candidate.id === runId
        ? {
          ...candidate,
          aborted: false,
          skipped: candidate.skipped.filter((id) => id !== stepId),
        }
        : candidate
    )));
    return true;
  }, [enqueueRun, runs]);

  const clearRun = useCallback((runId: string) => {
    removeRun(runId);
    setRuns((current) => current.filter((run) => run.id !== runId));
  }, [removeRun]);

  const tabsById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );

  return {
    abortRun,
    clearRun,
    draft,
    duplicateRecipe,
    recipes,
    removeRecipe,
    resendStep,
    runs,
    saveRecipe,
    skipStep,
    startRun,
    tabsById,
  };
}
