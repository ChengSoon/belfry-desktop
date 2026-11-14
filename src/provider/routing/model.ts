import type { AgentKind } from "../../workspace/contracts";
import type { AgentProviderGroup } from "../contracts";
import type { ProjectAgentProvider } from "../project/contracts";

/** 配线台上的一个服务插孔。`official` 是固定的「官方登录」，不在任何 CLI 的列表里。 */
export interface RouteService {
  /** 按「名称 + 地址 + 模型」合并：同一个中转被多个 Agent 各存一份时，在配线台上是同一个插孔。 */
  key: string;
  name: string;
  baseUrl: string | null;
  model: string | null;
  /** 每个 Agent 在自己列表里的配置 id（同一服务各 CLI 的 id 不同）。 */
  ids: Partial<Record<AgentKind, string>>;
  /** 某个 Agent 的这份配置缺密钥时不能选。 */
  unusable: Partial<Record<AgentKind, true>>;
}

export interface RouteAgent {
  kind: AgentKind;
  /** null = 没读到这个 Agent（未安装或配置读不出）。 */
  current: string | null;
  /** 项目作用域：这一行是否是项目覆盖。全局作用域恒为 false。 */
  overridden: boolean;
  /** 项目作用域：覆盖指向的服务已被删除。 */
  missing: boolean;
  available: boolean;
}

export interface RouteModel { services: RouteService[]; agents: RouteAgent[] }

export const OFFICIAL = "official";
const serviceKey = (name: string, baseUrl: string, model: string) => JSON.stringify([name.trim(), baseUrl.trim(), model.trim()]);

function addService(services: Map<string, RouteService>, kind: AgentKind, id: string, name: string, baseUrl: string, model: string, usable: boolean) {
  const key = serviceKey(name, baseUrl, model);
  const service = services.get(key) ?? { key, name, baseUrl, model: model || null, ids: {}, unusable: {} };
  service.ids[kind] = id;
  if (!usable) service.unusable[kind] = true;
  services.set(key, service);
  return key;
}

function officialService(kinds: AgentKind[]): RouteService {
  return { key: OFFICIAL, name: "", baseUrl: null, model: null, ids: Object.fromEntries(kinds.map((kind) => [kind, OFFICIAL])), unusable: {} };
}

/** 全局作用域：直接来自 provider_list。 */
export function globalRoutes(order: readonly AgentKind[], groups: AgentProviderGroup[]): RouteModel {
  const services = new Map<string, RouteService>();
  const agents = order.map((kind): RouteAgent => {
    const group = groups.find((item) => item.kind === kind);
    if (!group) return { kind, current: null, overridden: false, missing: false, available: false };
    let current = OFFICIAL;
    for (const config of group.providers) {
      const key = addService(services, kind, config.id, config.name, config.baseUrl, config.model, true);
      if (config.id === group.currentId) current = key;
    }
    return { kind, current, overridden: false, missing: false, available: true };
  });
  return { services: [officialService(agents.filter((agent) => agent.available).map((agent) => agent.kind)), ...services.values()], agents };
}

/** 项目作用域：来自 project_provider_report。跟随全局的 Agent 接在固定的 OFFICIAL 插孔上，
    该插孔在项目作用域里含义是「跟随全局」，选它 = 删除项目覆盖。 */
export function projectRoutes(order: readonly AgentKind[], groups: ProjectAgentProvider[]): RouteModel {
  const services = new Map<string, RouteService>();
  const agents = order.map((kind): RouteAgent => {
    const group = groups.find((item) => item.kind === kind);
    if (!group) return { kind, current: null, overridden: false, missing: false, available: false };
    let current: string | null = null;
    for (const choice of group.choices) {
      const key = addService(services, kind, choice.id, choice.name, choice.baseUrl, choice.model, choice.configured);
      if (choice.id === group.providerId) current = key;
    }
    const overridden = group.source === "project";
    // 覆盖指向的服务已删除时不画线，由 missing 标出错误。
    if (!overridden) current = OFFICIAL;
    return { kind, current, overridden, missing: group.missing, available: true };
  });
  return { services: [officialService(agents.filter((agent) => agent.available).map((agent) => agent.kind)), ...services.values()], agents };
}

/** 这个 Agent 能不能接到这个服务（服务里有它的配置、且不缺密钥）。 */
export function canRoute(service: RouteService, kind: AgentKind) {
  return service.ids[kind] !== undefined && !service.unusable[kind];
}

export function routeCount(model: RouteModel, key: string) {
  return model.agents.filter((agent) => agent.available && agent.current === key).length;
}
