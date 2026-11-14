import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCcw, Settings2 } from "lucide-react";
import { Notice } from "../../components/Notice";
import { formatList, t, useTranslation } from "../../i18n";
import { AGENT_KINDS, type AgentKind } from "../../agent/contracts";
import { ICON } from "../../theme/sizing";
import { AGENT_ICONS } from "../../workspace/components/AgentIcons";
import type { ProjectWorkspace } from "../../workspace/contracts";
import { failureLabel } from "../../workspace/errors";
import { AGENT_LABEL } from "../contracts";
import { useProviders } from "../useProviders";
import { useProjectProviders } from "../project/useProjectProviders";
import { canRoute, globalRoutes, OFFICIAL, projectRoutes, routeCount, type RouteModel, type RouteService } from "./model";
import "./routing.css";

const ORDER: AgentKind[] = ["claude", ...AGENT_KINDS.filter((kind) => kind !== "claude")];
type Scope = "global" | "project";

/**
 * 模型服务 · 配线台（T41，稿：docs/design/belfry-ui/settings-v3/settings.html?page=models）。
 * 左边 Agent、右边服务，线就是路由。点 Agent 再点服务 = 改线，立刻写回 CLI 配置（同原来的「启用」）。
 * 新增 / 编辑 / 删除服务仍走原来的编辑器（onManage），这里只负责路由。
 */
export function ModelRouting({ project, onManage }: { project: ProjectWorkspace | null; onManage: () => void }) {
  useTranslation();
  const providers = useProviders(true);
  const projectModel = useProjectProviders(project?.rootPath ?? null);
  const [scope, setScope] = useState<Scope>("global");
  const [picked, setPicked] = useState<AgentKind | null>(null);
  const globalModel = useMemo(() => providers.catalog ? globalRoutes(ORDER, providers.catalog.agents) : null, [providers.catalog]);
  const model = useMemo<RouteModel | null>(() => scope === "global" ? globalModel
    : projectModel.report ? projectRoutes(ORDER, projectModel.report.agents) : null, [scope, globalModel, projectModel.report]);
  const busy = scope === "global" ? providers.loading : projectModel.busy;
  const conflicts = (scope === "global" ? providers.catalog?.envConflicts : projectModel.report?.envConflicts) ?? [];
  const failure = scope === "global" ? (providers.failure ? failureLabel(providers.failure) : null) : projectModel.failure;

  const route = (kind: AgentKind, service: RouteService) => {
    const id = service.key === OFFICIAL ? null : service.ids[kind] ?? null;
    if (scope === "global") void providers.select(kind, id);
    else projectModel.select(kind, id);
    setPicked(null);
  };
  const reload = () => { if (scope === "global") void providers.reload(); else projectModel.reload(); };
  const pickedAgent = picked ? model?.agents.find((agent) => agent.kind === picked) : undefined;
  const serviceName = (service: RouteService) => service.key === OFFICIAL
    ? t(scope === "global" ? "provider.ModelRouting.official" : "provider.ModelRouting.followGlobal") : service.name;

  return <section className="model-routing os-page" aria-label={t("provider.ModelRouting.title")}
    onKeyDown={(event) => { if (event.key === "Escape" && picked) { event.preventDefault(); event.stopPropagation(); setPicked(null); } }}>
    <div className="model-routing__bar">
      <p>{t("provider.ModelRouting.lede")}</p>
      <div className="model-routing__scope" role="tablist" aria-label={t("provider.ModelRouting.scope")}>
        <button type="button" role="tab" aria-selected={scope === "global"} onClick={() => { setScope("global"); setPicked(null); }}>{t("provider.ModelRouting.global")}</button>
        <button type="button" role="tab" aria-selected={scope === "project"} disabled={!project} title={project ? project.rootPath : t("provider.ModelRouting.noProject")}
          onClick={() => { setScope("project"); setPicked(null); }}>{project ? t("provider.ModelRouting.project", { name: project.name }) : t("provider.ModelRouting.projectNone")}</button>
      </div>
      <button type="button" className="os-btn icon" aria-label={t("provider.ModelRouting.reload")} title={t("provider.ModelRouting.reload")} disabled={busy} onClick={reload}>
        <RefreshCcw size={ICON.sm} aria-hidden="true" /></button>
      <button type="button" className="os-btn secondary" onClick={onManage}><Settings2 size={ICON.sm} aria-hidden="true" />{t("provider.ModelRouting.manage")}</button>
    </div>

    {conflicts.length ? <Notice tone="warning">{t(conflicts.some((item) => item.source === "shell") ? "provider.ProviderSection.shellOverride" : "provider.ProviderSection.processOverride", { names: formatList(conflicts.map((item) => item.name)) })}</Notice> : null}
    {failure ? <Notice action={<button type="button" disabled={busy} onClick={reload}>{t("provider.ModelRouting.reload")}</button>}>{failure}</Notice> : null}

    {model ? <PatchBay model={model} picked={picked} busy={busy} serviceName={serviceName}
      onPick={(kind) => setPicked((current) => current === kind ? null : kind)} onRoute={route} />
      : <div className="model-routing__loading os-group" role="status">{t("provider.ModelRouting.loading")}</div>}

    <div className="model-routing__readout" role="status">
      {pickedAgent && model ? <>
        <span className="model-routing__route"><b>{AGENT_LABEL[pickedAgent.kind]}</b><i aria-hidden="true">→</i>
          {pickedAgent.current ? serviceName(model.services.find((service) => service.key === pickedAgent.current)!) : t("provider.ModelRouting.unrouted")}</span>
        <span className="model-routing__hint">{t("provider.ModelRouting.pickHint")}</span>
        <span className="model-routing__sp" />
        <button type="button" className="os-btn secondary" onClick={() => setPicked(null)}>{t("provider.ModelRouting.done")}</button>
      </> : <>
        <span className="model-routing__hint">{t(scope === "global" ? "provider.ModelRouting.idleHint" : "provider.ModelRouting.idleHintProject")}</span>
        <span className="model-routing__sp" />
        {providers.notice && scope === "global" ? <span className="model-routing__notice">{providers.notice}</span> : null}
        <button type="button" className="os-btn secondary" onClick={onManage}><Plus size={ICON.sm} aria-hidden="true" />{t("provider.ModelRouting.add")}</button>
      </>}
    </div>
  </section>;
}

function PatchBay({ model, picked, busy, serviceName, onPick, onRoute }: {
  model: RouteModel; picked: AgentKind | null; busy: boolean; serviceName: (service: RouteService) => string;
  onPick: (kind: AgentKind) => void; onRoute: (kind: AgentKind, service: RouteService) => void;
}) {
  useTranslation();
  const bay = useRef<HTMLDivElement>(null);
  const [wires, setWires] = useState<{ kind: AgentKind; d: string; missing: boolean }[]>([]);
  const measure = useCallback(() => {
    const root = bay.current; if (!root) return;
    const box = root.getBoundingClientRect();
    const port = (selector: string) => {
      const rect = root.querySelector(selector)?.getBoundingClientRect();
      return rect ? [rect.left + rect.width / 2 - box.left, rect.top + rect.height / 2 - box.top] as const : null;
    };
    setWires(model.agents.flatMap((agent) => {
      if (!agent.available || !agent.current) return [];
      const index = model.services.findIndex((service) => service.key === agent.current);
      const from = port(`[data-agent-port="${agent.kind}"]`), to = index < 0 ? null : port(`[data-service-port="${index}"]`);
      if (!from || !to) return [];
      const dx = (to[0] - from[0]) / 2;
      return [{ kind: agent.kind, missing: agent.missing, d: `M${from[0]} ${from[1]} C${from[0] + dx} ${from[1]} ${to[0] - dx} ${to[1]} ${to[0]} ${to[1]}` }];
    }));
  }, [model]);
  useLayoutEffect(() => {
    measure();
    const root = bay.current; if (!root) return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [measure]);

  const pickedAgent = picked ? model.agents.find((agent) => agent.kind === picked) : undefined;
  return <div className="patch-bay" ref={bay}>
    <svg className="patch-bay__wires" aria-hidden="true">
      {wires.map((wire) => <path key={wire.kind} d={wire.d}
        className={`patch-bay__wire${picked ? (wire.kind === picked ? " is-focus" : " is-faded") : ""}`} />)}
    </svg>
    <div className="patch-bay__col patch-bay__agents" role="group" aria-label={t("provider.ModelRouting.agents")}>
      <h4>{t("provider.ModelRouting.agents")}</h4>
      {model.agents.map((agent) => {
        const Icon = AGENT_ICONS[agent.kind];
        const state = !agent.available ? " is-off" : picked ? (agent.kind === picked ? " is-picked" : " is-dim") : agent.current ? " is-live" : "";
        const sub = !agent.available ? t("provider.ModelRouting.unavailable") : agent.missing ? t("provider.ModelRouting.missing")
          : agent.overridden ? t("provider.ModelRouting.overridden") : null;
        return <button key={agent.kind} type="button" className={`patch-jack${state}${agent.missing ? " is-error" : ""}`}
          aria-pressed={agent.kind === picked} disabled={!agent.available || busy} onClick={() => onPick(agent.kind)}>
          <span className={`os-agent${agent.kind === "claude" ? " claude" : ""}`}><Icon size={ICON.sm} aria-hidden="true" /></span>
          <span className="patch-jack__text"><b>{AGENT_LABEL[agent.kind]}</b>{sub ? <small>{sub}</small> : null}</span>
          <span className="patch-jack__port" data-agent-port={agent.kind} />
        </button>;
      })}
    </div>
    <div className="patch-bay__col patch-bay__services" role="group" aria-label={t("provider.ModelRouting.services")}>
      <h4>{t("provider.ModelRouting.services")}</h4>
      {model.services.map((service, index) => {
        const count = routeCount(model, service.key);
        const target = pickedAgent ? canRoute(service, pickedAgent.kind) : false;
        const state = pickedAgent ? (pickedAgent.current === service.key ? " is-live is-current" : target ? " is-target" : " is-dim") : count ? " is-live" : "";
        return <button key={service.key} type="button" className={`patch-jack patch-jack--service${state}`}
          disabled={busy || !pickedAgent || !target || pickedAgent.current === service.key}
          aria-label={pickedAgent ? t("provider.ModelRouting.routeTo", { agent: AGENT_LABEL[pickedAgent.kind], service: serviceName(service) }) : undefined}
          onClick={() => pickedAgent && onRoute(pickedAgent.kind, service)}>
          {/* DOM 里只放序号：服务键含分隔符，不能直接进选择器。 */}
          <span className="patch-jack__port" data-service-port={index} />
          <span className="patch-jack__text"><b>{serviceName(service)}</b>
            <small>{service.key === OFFICIAL ? t("provider.ModelRouting.officialHint") : `${service.model || t("provider.ProviderSection.text_8a46967532")} · ${service.baseUrl}`}</small></span>
          <span className="patch-jack__count" title={t("provider.ModelRouting.count", { count })}>{count}</span>
        </button>;
      })}
    </div>
  </div>;
}
