import { CornerDownLeft, Play, Variable, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ICON } from "../../theme/sizing";
import type { WorkspaceTab } from "../../workspace/contracts";
import { promptTargetLabel } from "../../prompt/contracts";
import {
  buildRunSteps,
  canStartRecipe,
  missingRecipeVariables,
  recipeVariables,
  type Recipe,
} from "../contracts";

interface RecipeLauncherProps {
  agentTabs: readonly WorkspaceTab[];
  recipe: Recipe;
  initialTabId: string | null;
  onCancel: () => void;
  onStart: (tabId: string, values: Record<string, string>) => void;
}

/** 启动前那一步：填变量、挑目标会话、过一眼真正会发出去的文本。 */
export function RecipeLauncher({
  agentTabs,
  recipe,
  initialTabId,
  onCancel,
  onStart,
}: RecipeLauncherProps) {
  const variables = useMemo(() => recipeVariables(recipe.steps), [recipe.steps]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [targetTabId, setTargetTabId] = useState(
    initialTabId && agentTabs.some((tab) => tab.id === initialTabId)
      ? initialTabId
      : agentTabs[0]?.id ?? "",
  );

  const target = agentTabs.find((tab) => tab.id === targetTabId) ?? null;
  const missing = missingRecipeVariables(recipe.steps, values);
  const ready = canStartRecipe(recipe, values, target);
  const preview = useMemo(() => buildRunSteps(recipe, values), [recipe, values]);

  return (
    <div className="recipe-launcher">
      <div className="recipe-launcher__row">
        <label htmlFor="recipe-launcher-target">目标会话</label>
        <select
          id="recipe-launcher-target"
          disabled={agentTabs.length === 0}
          onChange={(event) => setTargetTabId(event.target.value)}
          value={targetTabId}
        >
          {agentTabs.length === 0 ? <option value="">没有 Agent 会话</option> : null}
          {agentTabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {promptTargetLabel(tab.kind)} · {tab.title}
            </option>
          ))}
        </select>
      </div>

      {variables.length > 0 ? (
        <div className="recipe-launcher__variables">
          <div className="recipe-launcher__legend">
            <Variable aria-hidden="true" size={ICON.xs} />
            <span>变量</span>
          </div>
          {variables.map((name) => (
            <div className="recipe-launcher__row" key={name}>
              <label htmlFor={`recipe-var-${name}`}>
                <code>{`{{${name}}}`}</code>
              </label>
              <input
                autoComplete="off"
                id={`recipe-var-${name}`}
                onChange={(event) => setValues(
                  (current) => ({ ...current, [name]: event.target.value }),
                )}
                placeholder="填入要替换的内容"
                spellCheck={false}
                value={values[name] ?? ""}
              />
            </div>
          ))}
        </div>
      ) : null}

      <ol className="recipe-launcher__preview">
        {preview.map((step, index) => (
          <li key={step.stepId}>
            <span className="recipe-launcher__index">{index + 1}</span>
            <pre>{step.text}</pre>
          </li>
        ))}
      </ol>

      <div className="recipe-launcher__actions">
        <span aria-live="polite" className="recipe-launcher__hint">
          {agentTabs.length === 0
            ? "先打开一个 Codex 或 Claude 会话"
            : missing.length > 0
              ? `还有 ${missing.length} 个变量没填：${missing.join("、")}`
              : `将按顺序发送 ${preview.length} 步`}
        </span>
        <button className="recipe-button" onClick={onCancel} type="button">取消</button>
        <button
          className="recipe-button recipe-button--primary"
          disabled={!ready}
          onClick={() => target && onStart(target.id, values)}
          type="button"
        >
          <Play aria-hidden="true" size={ICON.xs} />
          <span>开始</span>
        </button>
      </div>
    </div>
  );
}

interface RecipeLauncherHeaderProps {
  name: string;
  onClose: () => void;
}

export function RecipeLauncherHeader({ name, onClose }: RecipeLauncherHeaderProps) {
  return (
    <div className="recipe-panel__subhead">
      <strong>{name}</strong>
      <span><kbd>⌘/Ctrl</kbd><kbd><CornerDownLeft size={ICON.xs} /></kbd></span>
      <button
        aria-label="返回列表"
        className="icon-button icon-button--sm"
        onClick={onClose}
        title="返回列表"
        type="button"
      >
        <X aria-hidden="true" size={ICON.md} />
      </button>
    </div>
  );
}
