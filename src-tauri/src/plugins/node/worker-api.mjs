import { randomUUID } from "node:crypto";
import { reviveApiValue } from "./api-values.mjs";
import { collectClipboardHistory } from "./clipboard-client.mjs";
import { collectRange } from "./range-reader.mjs";

export function buildApi({ manifest, call, handlers }) {
  const invoke = (name) => (...args) => call(name, args).then((value) => reviveApiValue(name, value));
  const groups = {
    app: ["getVersion", "getLocale", "getAppearance"],
    plugin: ["getSettings", "setSettings", "getDataPath"],
    ui: ["openPanel", "closePanel", "showToast", "notify", "getNotificationPermission", "requestNotificationPermission", "showNativeNotification"],
    workspace: ["get"], fs: ["readText", "writeText", "stat", "readRange", "readPreview", "list", "glob", "remove", "requestDirectory", "openDefault", "reveal"],
    clipboard: ["readText", "writeText", "getHistory"], shell: ["openExternal"], net: ["fetch"],
    models: ["list"], session: ["getLlmContext"],
    browser: ["navigate", "action", "setBounds", "setVisible", "getState", "openExternal", "snapshot", "screenshot", "click", "fill", "evaluate", "console", "cdp"],
  };
  const api = Object.fromEntries(Object.entries(groups).map(([group, names]) =>
    [group, Object.fromEntries(names.map((name) => [name, invoke(`${group}.${name}`)]))]));
  api.plugin.getId = () => manifest.id;
  api.fs.readRange = (...args) => collectRange(({ path, offset, length, grantId }) => invoke("fs.readRange")(path, offset, length, grantId),
    { path: args[0], offset: args[1], length: args[2], grantId: args[3] });
  api.clipboard.getHistory = () => collectClipboardHistory(call);
  api.plugin.getManifest = () => structuredClone(manifest);
  const registered = (name, args) => { const promise = call(name, args); handlers.registrations.push(promise); return promise; };
  api.commands = registrations({ group: "commands", key: "id", callback: "run", handlers: handlers.commands }, registered);
  const tools = registrations({ group: "agent", key: "name", callback: "execute", handlers: handlers.tools }, registered);
  api.agent = { registerTool: tools.register, unregisterTool: tools.unregister, complete: invoke("agent.complete") };
  api.events = {
    on: (name, listener) => { const set = handlers.events.get(name) ?? new Set(); set.add(listener); handlers.events.set(name, set); },
    off: (name, listener) => handlers.events.get(name)?.delete(listener),
  };
  api.services = {
    register: (service) => {
      handlers.services.set(service.id, service);
      const promise = call("services.register", [{ id: service.id }]);
      handlers.registrations.push(promise);
      return promise;
    },
    unregister: async (id) => { await call("services.unregister", [id]); handlers.services.delete(id); },
  };
  api.bus = {
    publish: invoke("bus.publish"),
    subscribe: async (topic, listener) => {
      const id = randomUUID(); handlers.bus.set(id, listener);
      try { await call("bus.subscribe", [topic, id]); } catch (error) { handlers.bus.delete(id); throw error; }
      return async () => { await call("bus.unsubscribe", [id]); handlers.bus.delete(id); };
    },
  };
  return api;
}
function registrations({ group, key, callback, handlers }, call) {
  return {
    register: async (input) => {
      if (typeof input?.[callback] !== "function") throw new Error(`${group} 缺少 ${callback} 函数`);
      const { [callback]: run, ...descriptor } = input;
      await call(group === "agent" ? "agent.registerTool" : `${group}.register`, [descriptor]);
      handlers.set(input[key], run);
    },
    unregister: async (id) => {
      await call(group === "agent" ? "agent.unregisterTool" : `${group}.unregister`, [id]);
      handlers.delete(id);
    },
  };
}
