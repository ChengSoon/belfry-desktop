import { describe, expect, it } from "vitest";
import {
  applyRecipeVariables,
  buildRunSteps,
  canStartRecipe,
  isRecipeVariableName,
  missingRecipeVariables,
  recipeStepPreview,
  recipeSteps,
  recipeVariables,
  type Recipe,
} from "./contracts";

function recipe(overrides: Partial<Recipe> = {}): Recipe {
  return {
    id: "recipe-1",
    name: "发布前检查",
    description: null,
    steps: [
      { id: "s1", text: "跑 {{command}} 并总结失败项" },
      { id: "s2", text: "为 {{feature}} 写一段 CHANGELOG" },
    ],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("recipe variables", () => {
  it("collects unique names in first-appearance order", () => {
    expect(recipeVariables(recipe().steps)).toEqual(["command", "feature"]);
  });

  it("deduplicates a name repeated across steps", () => {
    const steps = [
      { id: "s1", text: "读 {{path}}" },
      { id: "s2", text: "再改 {{path}} 并测 {{path}}" },
    ];
    expect(recipeVariables(steps)).toEqual(["path"]);
  });

  it("treats spaced and malformed placeholders as literal text", () => {
    const steps = [{ id: "s1", text: "{{ spaced }} {{}} {{a.b}} {{ok}}" }];
    expect(recipeVariables(steps)).toEqual(["ok"]);
  });

  it("replaces every occurrence of a name", () => {
    expect(applyRecipeVariables("{{a}} 和 {{a}} 与 {{b}}", { a: "甲", b: "乙" }))
      .toBe("甲 和 甲 与 乙");
  });

  it("leaves unfilled placeholders untouched so the caller can block startup", () => {
    expect(applyRecipeVariables("{{a}}/{{b}}", { a: "有" })).toBe("有/{{b}}");
    expect(applyRecipeVariables("{{a}}", { a: "   " })).toBe("{{a}}");
  });

  it("reports which variables are still blank", () => {
    expect(missingRecipeVariables(recipe().steps, { command: "pnpm test" })).toEqual(["feature"]);
    expect(missingRecipeVariables(recipe().steps, { command: "x", feature: " " })).toEqual(["feature"]);
    expect(missingRecipeVariables(recipe().steps, { command: "x", feature: "y" })).toEqual([]);
  });

  it("validates variable names", () => {
    expect(isRecipeVariableName("feature-1_A")).toBe(true);
    expect(isRecipeVariableName("has space")).toBe(false);
    expect(isRecipeVariableName("")).toBe(false);
  });
});

describe("recipe startup gating", () => {
  const agent = { kind: "codex" as const, phase: "running" };

  it("requires an Agent session, filled variables, and a non-empty body", () => {
    const values = { command: "pnpm test", feature: "Recipe" };
    expect(canStartRecipe(recipe(), values, agent)).toBe(true);
    expect(canStartRecipe(recipe(), { command: "pnpm test" }, agent)).toBe(false);
    expect(canStartRecipe(recipe({ steps: [{ id: "s1", text: "  " }] }), values, agent)).toBe(false);
  });

  it("refuses shell, ssh, and dead sessions", () => {
    const values = { command: "x", feature: "y" };
    expect(canStartRecipe(recipe(), values, null)).toBe(false);
    expect(canStartRecipe(recipe(), values, { kind: "shell", phase: "running" })).toBe(false);
    expect(canStartRecipe(recipe(), values, { kind: "ssh", phase: "running" })).toBe(false);
    expect(canStartRecipe(recipe(), values, { kind: "codex", phase: "exited" })).toBe(false);
    expect(canStartRecipe(recipe(), values, { kind: "codex", phase: "error" })).toBe(false);
  });
});

describe("run step compilation", () => {
  it("snapshots substituted text and drops blank steps", () => {
    const source = recipe({
      steps: [
        { id: "s1", text: "跑 {{command}}" },
        { id: "s2", text: "   " },
        { id: "s3", text: "收尾" },
      ],
    });
    expect(recipeSteps(source)).toHaveLength(2);
    expect(buildRunSteps(source, { command: "pnpm build" })).toEqual([
      { stepId: "s1", text: "跑 pnpm build" },
      { stepId: "s3", text: "收尾" },
    ]);
  });
});

describe("recipeStepPreview", () => {
  it("collapses whitespace and truncates", () => {
    expect(recipeStepPreview("多行\n  文本   在此")).toBe("多行 文本 在此");
    expect(recipeStepPreview("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });
});
