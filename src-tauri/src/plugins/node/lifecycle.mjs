import { isDeepStrictEqual } from "node:util";
import { readDirectory } from "./directory.mjs";

const WATCH_INTERVAL = 750, RESTART_DELAY = 250, RESTART_WINDOW = 60_000, MAX_RESTARTS = 3;
export class Lifecycle {
  constructor(manager) { this.manager = manager; this.queues = new Map(); this.restarts = new Map(); }
  async serial(id, operation) {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(id, next);
    try { return await next; } finally { if (this.queues.get(id) === next) this.queues.delete(id); }
  }
  cancel(id) { const restart = this.restarts.get(id); clearTimeout(restart?.timer); this.restarts.delete(id); }
  watch(entry) {
    if (!entry.development || this.manager.closing) return;
    let reading = false;
    entry.watcher = setInterval(async () => {
      if (reading || entry.stopping || this.manager.closing) return;
      reading = true;
      try {
        const snapshot = await readDirectory(entry.path);
        if (snapshot.digest === entry.digest) return;
        await this.serial(entry.manifest.id, () => this.reload(entry, snapshot));
      } catch (error) {
        if (this.manager.entries.get(entry.manifest.id) === entry && !entry.stopping) {
          await this.manager.unload(entry.manifest.id);
          this.manager.errors.set(entry.manifest.id, error.message);
          this.manager.event("error", { pluginId: entry.manifest.id, message: error.message });
        }
      } finally { reading = false; }
    }, WATCH_INTERVAL);
    entry.watcher.unref();
  }
  async reload(entry, snapshot) {
    if (this.manager.entries.get(entry.manifest.id) !== entry || entry.stopping || this.manager.closing) return;
    if (!isDeepStrictEqual(snapshot.manifest, entry.manifest)) {
      await this.manager.unloadEntry(entry.manifest.id);
      this.manager.errors.set(entry.manifest.id, "manifest 已变化，请在插件中心重载并核对权限");
      this.manager.event("error", { pluginId: entry.manifest.id, message: "manifest 已变化，请重载" });
      return;
    }
    await this.manager.loadEntry({ path: entry.path, manifest: JSON.parse(JSON.stringify(entry.manifest)), development: true });
    this.manager.event("reloaded", { pluginId: entry.manifest.id });
  }
  crashed(entry) {
    clearInterval(entry.watcher);
    if (this.manager.closing || !entry.manifest.contributes?.services?.some((service) => service.autoRestart !== false)) return;
    const id = entry.manifest.id, now = Date.now();
    let state = this.restarts.get(id);
    if (!state || now - state.since > RESTART_WINDOW) state = { since: now, attempts: 0 };
    if (state.attempts >= MAX_RESTARTS) return;
    state.attempts++;
    state.timer = setTimeout(() => {
      if (this.manager.closing || this.restarts.get(id) !== state) return;
      void this.serial(id, () => this.manager.loadEntry({ path: entry.path, manifest: JSON.parse(JSON.stringify(entry.manifest)), development: entry.development }))
        .catch((error) => this.manager.event("error", { pluginId: id, message: error.message }));
    }, RESTART_DELAY * 2 ** (state.attempts - 1));
    this.restarts.set(id, state);
  }
  async close() {
    for (const id of this.restarts.keys()) this.cancel(id);
    await Promise.allSettled([...this.queues.values()]);
  }
}
