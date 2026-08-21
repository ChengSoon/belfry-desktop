import { ArrowDown, ArrowUp, Plus, Trash2, Variable } from "lucide-react";
import { useMemo, useState } from "react";
import { ICON } from "../../theme/sizing";
import {
  RECIPE_NAME_MAX,
  RECIPE_STEPS_MAX,
  createRecipeStep,
  recipeSteps,
  recipeVariables,
  type Recipe,
} from "../contracts";

interface RecipeEditorProps {
  recipe: Recipe;
  onCancel: () => void;
  onSave: (recipe: Recipe) => void;
}

/** 名称 + 多步文本。变量不用单独声明，写进步骤里的 `{{name}}` 就是声明。 */
export function RecipeEditor({ recipe, onCancel, onSave }: RecipeEditorProps) {
  const [draft, setDraft] = useState(recipe);
  const variables = useMemo(() => recipeVariables(draft.steps), [draft.steps]);
  const savable = draft.name.trim().length > 0 && recipeSteps(draft).length > 0;

  const patchStep = (id: string, text: string) => setDraft((current) => ({
    ...current,
    steps: current.steps.map((step) => (step.id === id ? { ...step, text } : step)),
  }));

  const addStep = () => setDraft((current) => (
    current.steps.length >= RECIPE_STEPS_MAX
      ? current
      : { ...current, steps: [...current.steps, createRecipeStep()] }
  ));

  const removeStep = (id: string) => setDraft((current) => (
    current.steps.length <= 1
      ? current
      : { ...current, steps: current.steps.filter((step) => step.id !== id) }
  ));

  const moveStep = (index: number, delta: number) => setDraft((current) => {
    const next = [...current.steps];
    const swap = index + delta;
    if (swap < 0 || swap >= next.length) return current;
    [next[index], next[swap]] = [next[swap], next[index]];
    return { ...current, steps: next };
  });

  return (
    <div className="recipe-editor">
      <div className="recipe-editor__meta">
        <input
          aria-label="Recipe 名称"
          autoComplete="off"
          maxLength={RECIPE_NAME_MAX}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          placeholder="名称，例如「发布前检查」"
          spellCheck={false}
          value={draft.name}
        />
        <input
          aria-label="Recipe 说明"
          autoComplete="off"
          onChange={(event) => setDraft((current) => ({
            ...current,
            description: event.target.value.trim() === "" ? null : event.target.value,
          }))}
          placeholder="说明（可选）"
          spellCheck={false}
          value={draft.description ?? ""}
        />
      </div>

      <div className="recipe-editor__steps">
        {draft.steps.map((step, index) => (
          <div className="recipe-editor__step" key={step.id}>
            <span className="recipe-editor__index">{index + 1}</span>
            <textarea
              aria-label={`第 ${index + 1} 步`}
              onChange={(event) => patchStep(step.id, event.target.value)}
              placeholder="这一步要发给 Agent 的内容，可用 {{变量}} 占位"
              rows={2}
              spellCheck={false}
              value={step.text}
            />
            <div className="recipe-editor__step-actions">
              <button
                aria-label="上移"
                disabled={index === 0}
                onClick={() => moveStep(index, -1)}
                title="上移"
                type="button"
              >
                <ArrowUp aria-hidden="true" size={ICON.xs} />
              </button>
              <button
                aria-label="下移"
                disabled={index === draft.steps.length - 1}
                onClick={() => moveStep(index, 1)}
                title="下移"
                type="button"
              >
                <ArrowDown aria-hidden="true" size={ICON.xs} />
              </button>
              <button
                aria-label="删除这一步"
                disabled={draft.steps.length <= 1}
                onClick={() => removeStep(step.id)}
                title="删除这一步"
                type="button"
              >
                <Trash2 aria-hidden="true" size={ICON.xs} />
              </button>
            </div>
          </div>
        ))}
        <button
          className="recipe-editor__add"
          disabled={draft.steps.length >= RECIPE_STEPS_MAX}
          onClick={addStep}
          type="button"
        >
          <Plus aria-hidden="true" size={ICON.xs} />
          <span>{draft.steps.length >= RECIPE_STEPS_MAX ? `最多 ${RECIPE_STEPS_MAX} 步` : "加一步"}</span>
        </button>
      </div>

      <div className="recipe-editor__foot">
        <span className="recipe-editor__variables">
          {variables.length > 0 ? (
            <>
              <Variable aria-hidden="true" size={ICON.xs} />
              <span>{variables.join("、")}</span>
            </>
          ) : (
            <span className="recipe-editor__muted">用 {"{{变量}}"} 可在启动前填值</span>
          )}
        </span>
        <button className="recipe-button" onClick={onCancel} type="button">取消</button>
        <button
          className="recipe-button recipe-button--primary"
          disabled={!savable}
          onClick={() => onSave({ ...draft, name: draft.name.trim() })}
          type="button"
        >
          保存
        </button>
      </div>
    </div>
  );
}
