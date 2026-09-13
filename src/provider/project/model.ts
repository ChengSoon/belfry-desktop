import type { ProjectAgentProvider } from "./contracts";

export function providerSource(group: ProjectAgentProvider) {
  if (group.missing) return "所选 Provider 已删除，请重新选择或跟随全局";
  return `${group.source === "project" ? "项目覆盖" : "跟随全局"} · ${group.effectiveName}`;
}

export function providerDetail(group: ProjectAgentProvider) {
  const choice = group.choices.find(({ id }) => id === group.providerId);
  if (!choice) return null;
  return { endpoint: choice.baseUrl, model: choice.model || "沿用 CLI 模型设置" };
}
