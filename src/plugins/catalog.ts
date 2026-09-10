import type { QuickOpenItem } from "../quickopen/model";
import type { Recipe, RecipeStep } from "../recipe/contracts";

// 仅模块内的已校验目录投影；不可用于解码 manifest/IPC，不能作为正式共享契约。
type TemplateProjection = {
  id: string;
  name: string;
  description?: string | null;
  steps: readonly RecipeStep[];
};
type SourceProjection = {
  pluginId: string;
  pluginName: string;
  version: string;
  /** 由未来宿主桥接综合启用、兼容、管理中与 owner 状态；不是运行授权。 */
  available: boolean;
  templates: readonly TemplateProjection[];
  actions: readonly {
    id: string;
    title: string;
    templateId: string;
    keywords?: readonly string[];
  }[];
};

function templateIdentity(pluginId: string, templateId: string) {
  return `plugin:${pluginId}:template:${templateId}`;
}

export function buildPluginCatalog(sources: readonly SourceProjection[]) {
  assertUnique(sources.map((source) => source.pluginId));
  const available = sources.filter((source) => source.available);
  available.forEach(assertReferences);
  const templates = available.flatMap((source) => source.templates.map((template) => ({
    ...template,
    id: templateIdentity(source.pluginId, template.id),
    templateId: template.id,
    pluginId: source.pluginId,
    pluginName: source.pluginName,
    version: source.version,
    steps: template.steps.map((step) => ({ ...step })),
  })));
  const actions = available.flatMap((source) => source.actions.map((action): QuickOpenItem => ({
    id: `plugin:${source.pluginId}:action:${action.id}`,
    kind: "action",
    title: action.title,
    subtitle: `${source.pluginName} · ${source.version}`,
    keywords: [source.pluginName, source.pluginId, ...(action.keywords ?? [])],
    value: templateIdentity(source.pluginId, action.templateId),
    icon: "list-checks",
  })));
  return { templates, actions };
}

/** 仅创建运行输入；Prompt 单步骤和 Recipe 多步骤使用同一路径，不写用户库。 */
export function adaptPluginTemplate(input: {
  pluginId: string;
  template: TemplateProjection;
  now: number;
}): Recipe {
  return {
    id: templateIdentity(input.pluginId, input.template.id),
    name: input.template.name,
    description: input.template.description ?? null,
    steps: input.template.steps.map((step) => ({ ...step })),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function assertUnique(ids: readonly string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("目录投影中有重复 ID");
}

function assertReferences(source: SourceProjection) {
  const ids = source.templates.map((template) => template.id);
  assertUnique(ids);
  assertUnique(source.actions.map((action) => action.id));
  if (source.actions.some((action) => !ids.includes(action.templateId))) {
    throw new Error("目录投影中的动作缺少目标模板");
  }
}
