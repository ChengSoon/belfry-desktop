import { RECIPE_NAME_MAX, RECIPE_STEPS_MAX, type Recipe, type RecipeStep } from "./contracts";

export const RECIPES_KEY = "belfry.recipes.v1";
export const RECIPES_LIMIT = 40;

export function loadRecipes(storage: Pick<Storage, "getItem"> = localStorage): Recipe[] {
  try {
    return parseRecipes(storage.getItem(RECIPES_KEY));
  } catch {
    return [];
  }
}

export function saveRecipes(
  recipes: readonly Recipe[],
  storage: Pick<Storage, "setItem"> = localStorage,
) {
  try {
    storage.setItem(RECIPES_KEY, JSON.stringify(recipes.slice(0, RECIPES_LIMIT)));
  } catch {
    // localStorage 被禁用时退化为本次运行内有效，不影响已经在跑的轮次。
  }
}

/**
 * 逐字段校验后再放行。坏掉的单条直接丢弃而不是整份作废——一条手改坏的 Recipe
 * 不该让其余全部消失。
 */
export function parseRecipes(value: string | null): Recipe[] {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];

  const ids = new Set<string>();
  return parsed
    .flatMap((entry): Recipe[] => {
      if (!isPersistedRecipe(entry) || ids.has(entry.id)) return [];
      ids.add(entry.id);
      return [{
        id: entry.id,
        name: entry.name.slice(0, RECIPE_NAME_MAX),
        description: entry.description ?? null,
        steps: entry.steps.slice(0, RECIPE_STEPS_MAX),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      }];
    })
    .slice(0, RECIPES_LIMIT);
}

function isPersistedRecipe(value: unknown): value is Recipe {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && value.id.length > 0
    && typeof value.name === "string"
    && value.name.length > 0
    && (value.description === undefined
      || value.description === null
      || typeof value.description === "string")
    && Array.isArray(value.steps)
    && value.steps.length > 0
    && value.steps.every(isRecipeStep)
    && typeof value.createdAt === "number"
    && Number.isFinite(value.createdAt)
    && typeof value.updatedAt === "number"
    && Number.isFinite(value.updatedAt);
}

function isRecipeStep(value: unknown): value is RecipeStep {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && value.id.length > 0
    && typeof value.text === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
