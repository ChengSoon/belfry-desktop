import type { QuickOpenItem } from "../quickopen/model";
import type { PluginStep } from "./contracts";

// 仅模块内的已校验目录投影；不可用于解码 manifest/IPC，不能作为正式共享契约。
type TemplateProjection = {
  id: string;
  name: string;
  description?: string | null;
  steps: readonly PluginStep[];
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
