import { apiError, permission } from "./errors.mjs";
import { matches } from "./fs-policy.mjs";

export class Extensions {
  constructor(event) { this.event = event; this.services = new Map(); this.subscriptions = new Map(); }
  async service(entry, api, args) {
    permission(entry, "background.service");
    const id = api.endsWith("unregister") ? args[0] : args[0]?.id;
    const key = `${entry.manifest.id}:${id}`;
    if (api.endsWith("unregister")) {
      const service = this.services.get(key);
      if (service?.status === "running") await entry.child.invoke("service", { id, action: "stop" });
      this.services.delete(key); return null;
    }
    const descriptor = entry.manifest.contributes?.services?.find((item) => item.id === id);
    if (!descriptor || entry.stopping) throw apiError("PERMISSION_DENIED", "服务未声明或插件已停止");
    this.services.set(key, { ...descriptor, pluginId: entry.manifest.id, pluginName: entry.manifest.name, status: "registered" });
    if (entry.status === "ready" && entry.scopeActive !== false) await this.start(entry);
    return null;
  }
  async start(entry) {
    for (const service of this.services.values()) {
      if (service.pluginId !== entry.manifest.id || !["registered", "stopped"].includes(service.status)) continue;
      await entry.child.invoke("service", { id: service.id, action: "start" });
      service.status = "running";
    }
  }
  async stop(entry) {
    for (const service of this.services.values()) {
      if (service.pluginId !== entry.manifest.id || service.status !== "running") continue;
      await entry.child.invoke("service", { id: service.id, action: "stop" }, { timeout: 2000 }).catch(() => {});
      service.status = "stopped";
    }
  }
  bus(entry, api, args) {
    if (api === "bus.unsubscribe") { this.subscriptions.delete(`${entry.manifest.id}:${args[0]}`); return null; }
    const publish = api === "bus.publish", topic = args[0];
    permission(entry, publish ? "bus.publish" : "bus.subscribe");
    if (entry.stopping || typeof topic !== "string" || topic.length > 128) throw apiError("INVALID_ARGUMENT", "主题无效");
    const declared = entry.manifest.contributes?.bus?.[publish ? "publish" : "subscribe"] ?? [];
    if (!declared.includes(topic)) throw apiError("PERMISSION_DENIED", "消息主题未声明");
    return publish ? this.publish(entry, topic, args[1]) : this.subscribe(entry, topic, args[1]);
  }
  subscribe(entry, topic, id) {
    if (this.subscriptions.size >= 1000) throw apiError("LIMIT_EXCEEDED", "订阅超额");
    this.subscriptions.set(`${entry.manifest.id}:${id}`, { entry, topic, id });
    return null;
  }
  publish(entry, topic, payload = null) {
    if (Buffer.byteLength(JSON.stringify(payload)) > 64 * 1024) throw apiError("LIMIT_EXCEEDED", "消息超额");
    const message = { topic, payload, from: entry.manifest.id, timestamp: new Date().toISOString() };
    for (const subscription of this.subscriptions.values()) {
      if (subscription.entry === entry || subscription.entry.scopeActive === false || !matches(subscription.topic, topic, ".")) continue;
      subscription.entry.child.send({ type: "event", name: "bus", subscriptionId: subscription.id, args: [message] });
    }
    return null;
  }
  forget(id) {
    for (const [key, item] of this.services) if (item.pluginId === id) this.services.delete(key);
    for (const [key, item] of this.subscriptions) if (item.entry.manifest.id === id) this.subscriptions.delete(key);
  }
}
