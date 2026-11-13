import { Notice } from "../../components/Notice";
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
import { AGENT_ICONS } from "../../workspace/components/AgentIcons";
import "../../settings/obsidianSections.css";

/** 曜石稿（T19 project）：项目头 group、环境变量 warning notice、各 Agent 是 group 内一行（图标块 + 名称/来源徽标 + 说明 + 38 高下拉）。 */
export function ProjectProviderSection({ project }: { project: ProjectWorkspace | null }) {
  useTranslation();
  const model = useProjectProviders(project?.rootPath ?? null);
  const conflicts = model.report?.envConflicts ?? [];
  return <section className="project-provider os-page" aria-label={t("provider.ProjectProviderSection.text_7728844289")}>
    <SettingsHeader
      actions={<button type="button" className="os-btn icon" aria-label={t("provider.ProjectProviderSection.text_45f6e66c5a")} title={t("provider.ProjectProviderSection.text_45f6e66c5a")}
        disabled={!project || model.busy} onClick={model.reload}><RefreshCcw size={ICON.sm} aria-hidden="true" /></button>}
      description={t("provider.ProjectProviderSection.text_631e23c5bd")}
      title={t("provider.ProjectProviderSection.text_784caf2b25")}
    />
    {!project ? <div className="os-group"><p className="os-empty project-provider__empty"><FolderGit2 aria-hidden="true" />{t("provider.ProjectProviderSection.text_d682064fae")}</p></div> : <>
      <div className="os-group"><div className="project-provider__project"><FolderGit2 size={ICON.md} aria-hidden="true" />
        <div><strong>{project.name}</strong><span title={project.rootPath}>{project.rootPath}</span></div>
      </div></div>
      {model.failure ? <Notice className="project-provider__error" action={<button type="button" disabled={model.busy} onClick={model.reload}>{t("provider.ProjectProviderSection.text_45f6e66c5a")}</button>}>{model.failure}</Notice> : null}
      {conflicts.length ? <Notice className="project-provider__conflicts" tone="warning">
        <strong>{t("provider.ProjectProviderSection.text_fc19bb6fa1", { count: conflicts.length })}</strong>
        {formatList(conflicts.map(({ name, source }) => t(source === "shell" ? "provider.ProjectProviderSection.shellVariable" : "provider.ProjectProviderSection.processVariable", { name })))}
        <p>{t("provider.ProjectProviderSection.text_7e0803e4d7")}</p>
      </Notice> : null}
      <section className="os-section">
        <div className="os-group-head"><h3>{t("provider.ProjectProviderSection.agentsTitle")}</h3>
          <span className="os-meta">{t("provider.ProjectProviderSection.text_ae15fb793d")}</span></div>
        <div className="os-group">
          {model.busy && !model.report ? <p className="os-empty" role="status">{t("provider.ProjectProviderSection.text_8dbc0ece43")}</p> : null}
          {model.report?.agents.map((group) => <ProjectProviderRow key={group.kind} group={group} disabled={model.busy} onSelect={model.select} />)}
        </div>
        {model.busy && model.report ? <p className="project-provider__notice" role="status">{t("provider.ProjectProviderSection.text_8dbc0ece43")}</p> : null}
        <p className="project-provider__notice">{t("provider.ProjectProviderSection.text_a2c7fa03de")}</p>
      </section>
    </>}
  </section>;
}

export function ProjectProviderRow({ group, disabled, onSelect }: {
  group: ProjectAgentProvider; disabled: boolean; onSelect: (kind: AgentKind, providerId: string | null) => void;
}) {
  useTranslation();
  const detail = providerDetail(group);
  const Icon = AGENT_ICONS[group.kind];
  const status = group.missing ? t("provider.ProjectProviderSection.text_138196ffa8")
    : group.source === "project"
      ? t(group.choices.find((choice) => choice.id === group.providerId)?.configured ? "provider.ProjectProviderSection.selectedWithKey" : "provider.ProjectProviderSection.selectedWithoutKey")
      : t("provider.ProjectProviderSection.text_594c3499f7");
  return <article className={`os-row with-agent project-provider__agent${group.missing ? " is-missing" : ""}`}>
    <span className={`os-agent${group.kind === "claude" ? " claude" : ""}`}><Icon aria-hidden="true" size={ICON.sm} /></span>
    <div className="os-row__body">
      <div className="os-row__label"><strong>{AGENT_LABEL[group.kind]}</strong>
        <span className={`os-tag project-provider__source${group.missing ? " err" : group.source === "project" ? " accent" : ""}`} role="status">{providerSource(group)}</span></div>
      <p className="os-row__hint project-provider__status" role={group.missing ? "alert" : undefined}>{status}</p>
      {detail ? <div className="os-row__sub"><span>{t("provider.ProjectProviderSection.text_52fff1680d")}</span><span className="os-mono">{detail.endpoint}</span>
        <span>{t("provider.ProjectProviderSection.text_c98e118e0a")}</span><span className="os-mono">{detail.model}</span></div> : null}
      <p className="os-row__hint project-provider__verify">{!group.choices.length ? t("provider.ProjectProviderSection.text_89fc72f22c") : t("provider.ProjectProviderSection.text_9c05485220")}</p>
    </div>
    <div className="os-trail">
      <Select className={group.missing ? "is-error" : undefined} ariaLabel={t("provider.ProjectProviderSection.text_bb4b8838ba", { agent: AGENT_LABEL[group.kind] })} value={group.providerId ?? ""} disabled={disabled}
        onChange={(value) => onSelect(group.kind, value || null)} options={projectProviderOptions(group)} />
    </div>
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
