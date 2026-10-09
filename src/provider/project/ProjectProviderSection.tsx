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
  const model = useProjectProviders(project?.rootPath ?? null);
  return <section className="project-provider" aria-label="项目 Provider 设置">
    <SettingsHeader
      actions={<button type="button" className="icon-button" aria-label="刷新项目 Provider" title="刷新项目 Provider"
        disabled={!project || model.busy} onClick={model.reload}><RefreshCcw size={ICON.md} aria-hidden="true" /></button>}
      description="作用域 · 当前本地项目。覆盖全局默认路由，不改写全局 CLI 配置。"
      title="项目 Provider"
    />
    {!project ? <p className="project-provider__empty">先打开一个本地项目，再设置项目 Provider。SSH 会话不使用本机覆盖。</p> : <>
      <div className="project-provider__project"><FolderGit2 size={ICON.md} aria-hidden="true" />
        <div><strong>{project.name}</strong><span title={project.rootPath}>{project.rootPath}</span></div>
      </div>
      {model.failure ? <p className="project-provider__error" role="alert">{model.failure}</p> : null}
      {model.busy ? <p className="project-provider__notice" role="status">正在读取或保存项目选择…</p> : null}
      {model.report?.agents.map((group) => <ProjectProviderRow key={group.kind} group={group} disabled={model.busy} onSelect={model.select} />)}
      <p className="project-provider__notice">对新建和继续的会话生效，已运行会话需重开。</p>
      {model.report?.envConflicts.length ? <Disclosure className="project-provider__conflicts"
        title={`环境变量可能覆盖全局配置 · ${model.report.envConflicts.length} 项`}>
        <p>{model.report.envConflicts.map(({ name, source }) => `${name}（${source === "shell" ? "登录 Shell" : "宿主进程"}）`).join("、")}</p>
        <p>项目覆盖会为新进程固定所选路由和凭据；跟随全局时，环境变量仍可能覆盖全局 CLI 配置。</p>
      </Disclosure> : null}
      <p className="project-provider__notice">在“全局 Provider”中添加或编辑服务。</p>
    </>}
  </section>;
}

export function ProjectProviderRow({ group, disabled, onSelect }: {
  group: ProjectAgentProvider; disabled: boolean; onSelect: (kind: AgentKind, providerId: string | null) => void;
}) {
  const detail = providerDetail(group);
  return <article className="project-provider__agent">
    <label><strong>{AGENT_LABEL[group.kind]}</strong>
      <Select ariaLabel={`${AGENT_LABEL[group.kind]} 项目 Provider`} value={group.providerId ?? ""} disabled={disabled}
        onChange={(value) => onSelect(group.kind, value || null)} options={projectProviderOptions(group)} />
    </label>
    <p className={group.missing ? "project-provider__error" : "project-provider__source"} role={group.missing ? "alert" : "status"}>{providerSource(group)}</p>
    <p className="project-provider__notice">{group.missing ? "项目选择不可用，请重新选择。"
      : group.source === "project"
        ? `项目已选用 · ${group.choices.find((choice) => choice.id === group.providerId)?.configured ? "已配置独立密钥" : "未配置独立密钥"}`
        : "路由与凭据跟随全局 CLI；此处不验证全局凭据。"} 连接未验证。</p>
    {detail ? <dl><dt>端点</dt><dd>{detail.endpoint}</dd><dt>模型</dt><dd>{detail.model}</dd></dl> : null}
    {!group.choices.length ? <p className="project-provider__notice">尚未保存 Provider，可先在“全局 Provider”中添加。</p> : null}
  </article>;
}

export function projectProviderOptions(group: ProjectAgentProvider): SelectOption<string>[] {
  return [
    { value: "", label: "跟随全局 CLI 配置" },
    ...(group.missing ? [{ value: group.providerId ?? "", label: "已删除的 Provider", disabled: true }] : []),
    ...group.choices.map((choice) => ({ value: choice.id, label: choice.name,
      disabled: !choice.configured, description: choice.configured ? undefined : "未配置独立 API Key" })),
  ];
}
