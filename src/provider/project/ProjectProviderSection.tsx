import { formatList, t, useTranslation } from "../../i18n";
import { FolderGit2, RefreshCcw } from "lucide-react";
import { ICON } from "../../theme/sizing";
import { SettingsHeader } from "../../settings/SettingsHeader";
import type { AgentKind, ProjectWorkspace } from "../../workspace/contracts";
import { AGENT_LABEL } from "../contracts";
import type { ProjectAgentProvider } from "./contracts";
import { providerDetail, providerSource } from "./model";
import { useProjectProviders } from "./useProjectProviders";
import "./projectProvider.css";
import { Select, type SelectOption } from "../../components/controls/Select";
import { Disclosure } from "../../components/controls/Disclosure";

export function ProjectProviderSection({ project }: { project: ProjectWorkspace | null }) {
  useTranslation();
  const model = useProjectProviders(project?.rootPath ?? null);
  return <section className="project-provider" aria-label={t("provider.ProjectProviderSection.text_7728844289")}>
    <SettingsHeader
      actions={<button type="button" className="icon-button" aria-label={t("provider.ProjectProviderSection.text_45f6e66c5a")} title={t("provider.ProjectProviderSection.text_45f6e66c5a")}
        disabled={!project || model.busy} onClick={model.reload}><RefreshCcw size={ICON.md} aria-hidden="true" /></button>}
      description={t("provider.ProjectProviderSection.text_631e23c5bd")}
      title={t("provider.ProjectProviderSection.text_784caf2b25")}
    />
    {!project ? <p className="project-provider__empty">{t("provider.ProjectProviderSection.text_d682064fae")}</p> : <>
      <div className="project-provider__project"><FolderGit2 size={ICON.md} aria-hidden="true" />
        <div><strong>{project.name}</strong><span title={project.rootPath}>{project.rootPath}</span></div>
      </div>
      {model.failure ? <p className="project-provider__error" role="alert">{model.failure}</p> : null}
      {model.busy ? <p className="project-provider__notice" role="status">{t("provider.ProjectProviderSection.text_8dbc0ece43")}</p> : null}
      {model.report?.agents.map((group) => <ProjectProviderRow key={group.kind} group={group} disabled={model.busy} onSelect={model.select} />)}
      <p className="project-provider__notice">{t("provider.ProjectProviderSection.text_ae15fb793d")}</p>
      {model.report?.envConflicts.length ? <Disclosure className="project-provider__conflicts"
        title={t("provider.ProjectProviderSection.text_fc19bb6fa1", { count: model.report.envConflicts.length })}>
        <p>{formatList(model.report.envConflicts.map(({ name, source }) => t(source === "shell" ? "provider.ProjectProviderSection.shellVariable" : "provider.ProjectProviderSection.processVariable", { name })))}</p>
        <p>{t("provider.ProjectProviderSection.text_7e0803e4d7")}</p>
      </Disclosure> : null}
      <p className="project-provider__notice">{t("provider.ProjectProviderSection.text_a2c7fa03de")}</p>
    </>}
  </section>;
}

export function ProjectProviderRow({ group, disabled, onSelect }: {
  group: ProjectAgentProvider; disabled: boolean; onSelect: (kind: AgentKind, providerId: string | null) => void;
}) {
  useTranslation();
  const detail = providerDetail(group);
  return <article className="project-provider__agent">
    <label><strong>{AGENT_LABEL[group.kind]}</strong>
      <Select ariaLabel={t("provider.ProjectProviderSection.text_bb4b8838ba", { agent: AGENT_LABEL[group.kind] })} value={group.providerId ?? ""} disabled={disabled}
        onChange={(value) => onSelect(group.kind, value || null)} options={projectProviderOptions(group)} />
    </label>
    <p className={group.missing ? "project-provider__error" : "project-provider__source"} role={group.missing ? "alert" : "status"}>{providerSource(group)}</p>
    <p className="project-provider__notice">{group.missing ? t("provider.ProjectProviderSection.text_138196ffa8")
      : group.source === "project"
        ? t(group.choices.find((choice) => choice.id === group.providerId)?.configured ? "provider.ProjectProviderSection.selectedWithKey" : "provider.ProjectProviderSection.selectedWithoutKey")
        : t("provider.ProjectProviderSection.text_594c3499f7")}</p>
    <p className="project-provider__notice">{t("provider.ProjectProviderSection.text_9c05485220")}</p>
    {detail ? <dl><dt>{t("provider.ProjectProviderSection.text_52fff1680d")}</dt><dd>{detail.endpoint}</dd><dt>{t("provider.ProjectProviderSection.text_c98e118e0a")}</dt><dd>{detail.model}</dd></dl> : null}
    {!group.choices.length ? <p className="project-provider__notice">{t("provider.ProjectProviderSection.text_89fc72f22c")}</p> : null}
  </article>;
}

export function projectProviderOptions(group: ProjectAgentProvider): SelectOption<string>[] {
  return [
    { value: "", label: t("provider.ProjectProviderSection.text_d51f8906cc") },
    ...(group.missing ? [{ value: group.providerId ?? "", label: t("provider.ProjectProviderSection.text_0ee2b08347"), disabled: true }] : []),
    ...group.choices.map((choice) => ({ value: choice.id, label: choice.name,
      disabled: !choice.configured, description: choice.configured ? undefined : t("provider.ProjectProviderSection.text_e05f07c5d8") })),
  ];
}
