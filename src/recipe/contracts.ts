import type { WorkspaceTabKind } from "../workspace/contracts";

export interface RecipeStep {
  id: string;
  text: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string | null;
  steps: RecipeStep[];
  createdAt: number;
  updatedAt: number;
}

/**
 * 一步的处境。
 *
 * 刻意没有 completed / failed：那需要 Agent 的结构化状态通道（AgentCapabilities.structuredState
 * 目前是 false），屏幕文本给不出「这一步做成了没」。`dispatched` 只声称交给了终端。
 */
export type RecipeStepStatus = "pending" | "dispatched" | "skipped";

/** 整轮的处境。blocked 是从目标会话现况派生的，不存进状态，避免和真实终端不同步。 */
export type RecipeRunStatus = "running" | "blocked" | "finished" | "aborted";

export type RecipeBlockedReason = "awaiting-choice" | "session-gone";

/** 一轮运行里的一步：文本是启动那一刻替换完变量的快照，之后改 Recipe 不影响在跑的轮次。 */
export interface RecipeRunStep {
  stepId: string;
  text: string;
}

/**
 * 一轮运行的记录。只活在内存里——会话进程本身跨不过应用重启，存下来也只是具误导性的空壳。
 *
 * 步骤状态不记在这里，而是每次从 Prompt 队列现况派生：队列里还有 = 待发送，没了 = 已送达。
 * 这样终端重挂导致的回滚会自动把状态退回待发送，比自己记账准。
 */
export interface RecipeRun {
  id: string;
  recipeId: string;
  recipeName: string;
  tabId: string;
  steps: RecipeRunStep[];
  startedAt: number;
  /** 用户中止过。中止只清未派发的步骤，已交给终端的拦不回来。 */
  aborted: boolean;
  /** 被用户跳过的 stepId。 */
  skipped: string[];
}

export const RECIPE_NAME_MAX = 60;
export const RECIPE_STEPS_MAX = 20;

/** `{{name}}`。名称收紧到这套字符，`{{ foo }}` 这类带空格的写法按字面文本处理。 */
const VARIABLE_PATTERN = /\{\{([A-Za-z0-9_-]+)\}\}/gu;

export function isRecipeVariableName(value: string) {
  return /^[A-Za-z0-9_-]+$/u.test(value);
}

/** 全部步骤里出现过的变量名，按首次出现顺序去重——填写表单跟着步骤顺序读下来才顺。 */
export function recipeVariables(steps: readonly RecipeStep[]): string[] {
  const names: string[] = [];
  for (const step of steps) {
    for (const match of step.text.matchAll(VARIABLE_PATTERN)) {
      const name = match[1];
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

/** 同名占位符全部替换。未提供的变量原样留着，交给 missingRecipeVariables 拦在启动之前。 */
export function applyRecipeVariables(text: string, values: Readonly<Record<string, string>>) {
  return text.replace(VARIABLE_PATTERN, (match, name: string) => {
    const value = values[name];
    return value === undefined || value.trim() === "" ? match : value;
  });
}

/** 空白视同没填：把 `{{feature}}` 原样发给 Agent 只会让它困惑，不如挡住启动按钮。 */
export function missingRecipeVariables(
  steps: readonly RecipeStep[],
  values: Readonly<Record<string, string>>,
) {
  return recipeVariables(steps).filter((name) => (values[name] ?? "").trim() === "");
}

/** Recipe 能不能跑：得有非空步骤，变量得填齐。 */
export function canStartRecipe(
  recipe: Recipe,
  values: Readonly<Record<string, string>>,
  target: { kind: WorkspaceTabKind; phase: string } | null,
) {
  if (!target || target.kind === "shell" || target.kind === "ssh") return false;
  if (target.phase === "exited" || target.phase === "error") return false;
  if (recipeSteps(recipe).length === 0) return false;
  return missingRecipeVariables(recipe.steps, values).length === 0;
}

/** 丢掉空步骤：编辑器允许留空行草稿，但空步骤没有发送的意义。 */
export function recipeSteps(recipe: Recipe) {
  return recipe.steps.filter((step) => step.text.trim().length > 0);
}

/** 把 Recipe 定义编译成这一轮要发的文本快照。 */
export function buildRunSteps(
  recipe: Recipe,
  values: Readonly<Record<string, string>>,
): RecipeRunStep[] {
  return recipeSteps(recipe).map((step) => ({
    stepId: step.id,
    text: applyRecipeVariables(step.text, values),
  }));
}

export function createRecipeStep(text = ""): RecipeStep {
  return { id: crypto.randomUUID(), text };
}

export function createRecipe(now = Date.now()): Recipe {
  return {
    id: crypto.randomUUID(),
    name: "",
    description: null,
    steps: [createRecipeStep()],
    createdAt: now,
    updatedAt: now,
  };
}

export function recipeStepPreview(text: string, maxLength = 72) {
  const compact = text.replace(/\s+/gu, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}
