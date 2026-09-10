import { normalizeMarketSettings } from "./management.mjs";

export async function administration(manager, method, params) {
  const handlers = {
    "management.get": () => manager.management.snapshot(),
    "management.sync": () => { manager.installed = params.plugins; return null; },
    "management.source": () => setSource(manager, params.settings),
    "management.plugin": () => setPlugin(manager, params),
    "market.search": () => manager.market.search(params),
    "market.refresh": () => manager.market.refresh(),
    "market.detail": () => manager.market.detail(params.id),
    "market.prepare": () => manager.market.prepare(params),
    "market.updates": async () => ({ updates: await manager.market.updates(params.refreshRemote !== false) }),
    "market.plan": () => manager.market.updatePlan(),
    "market.personal.info": () => manager.market.personal.info(),
    "market.personal.configure": () => manager.market.personal.configure(params),
    "market.personal.publish": () => manager.market.personal.publish(params),
    "market.personal.export": () => manager.market.personal.export(params.directory),
  };
  if (!Object.hasOwn(handlers, method)) throw new Error(`未知插件管理操作：${method}`);
  return handlers[method]();
}
async function setSource(manager, settings) {
  const normalized = normalizeMarketSettings(settings), source = manager.market.source(normalized);
  if (source) {
    try { await manager.market.refresh(source); }
    catch (error) { if (!await manager.market.cached(source)) throw error; }
  }
  return manager.management.setSource(normalized);
}
async function setPlugin(manager, params) {
  const value = await manager.management.setPlugin(params.id, params.patch);
  const entry = manager.entries.get(params.id);
  if (entry) { entry.scope = manager.management.preference(params.id).scope; await manager.activateScope(entry); }
  manager.event("catalogChanged", { pluginId: params.id }); return value;
}
