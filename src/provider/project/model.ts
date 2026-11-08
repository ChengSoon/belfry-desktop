import { t } from "../../i18n";
import type { ProjectAgentProvider } from "./contracts";

export function providerSource(group: ProjectAgentProvider) {
  if (group.missing) return t("provider.model.text_96e92fb9a9");
  return `${group.source === "project" ? t("provider.model.text_686aeb7539") : t("provider.model.text_bba7ef6ba2")} · ${group.effectiveName}`;
}

export function providerDetail(group: ProjectAgentProvider) {
  const choice = group.choices.find(({ id }) => id === group.providerId);
  if (!choice) return null;
  return { endpoint: choice.baseUrl, model: choice.model || t("provider.model.text_047fc11fa5") };
}
