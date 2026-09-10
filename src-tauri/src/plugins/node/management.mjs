import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { apiError } from "./errors.mjs";
import { isObject, validId } from "./manifest-values.mjs";

const MAX_BYTES = 1024 * 1024;
const DEFAULTS = { settings: { pluginMarketSource: "personal", pluginMarketCustomUrl: "" }, plugins: {} };
export class PluginManagement {
  constructor(base) { this.base = base; this.value = structuredClone(DEFAULTS); this.writes = Promise.resolve(); }
  async init() {
    const value = await readJson(join(this.base, "management.json"));
    if (value) {
      if (!isObject(value.settings) || !isObject(value.plugins)) throw apiError("INVALID_ARGUMENT", "插件管理设置无效，原文件已保留");
      this.value = { settings: { ...DEFAULTS.settings, ...value.settings }, plugins: value.plugins };
    }
    return this;
  }
  snapshot() { return structuredClone(this.value); }
  preference(id) { return this.value.plugins[id] ?? {}; }
  update(operation) {
    const next = this.writes.catch(() => {}).then(async () => {
      const value = structuredClone(this.value); operation(value);
      await writeJson(join(this.base, "management.json"), value);
      this.value = value; return this.snapshot();
    });
    this.writes = next; return next;
  }
  setSource(settings) {
    const normalized = normalizeMarketSettings(settings);
    return this.update((value) => { value.settings = normalized; });
  }
  setPlugin(id, patch) {
    if (!validId(id) || !isObject(patch)) throw apiError("INVALID_ARGUMENT", "插件管理参数无效");
    if (Object.keys(patch).some((key) => !["scope", "autoUpdate", "marketplace"].includes(key))) throw apiError("INVALID_ARGUMENT", "未知插件管理字段");
    if (patch.autoUpdate !== undefined && typeof patch.autoUpdate !== "boolean") throw apiError("INVALID_ARGUMENT", "自动更新设置无效");
    if (patch.scope) patch = { ...patch, scope: normalizeScope(patch.scope) };
    return this.update((value) => { value.plugins[id] = { ...value.plugins[id], ...patch }; });
  }
}
export function normalizeMarketSettings(settings) {
  if (!isObject(settings) || !["personal", "belfry", "official", "mirror", "custom"].includes(settings.pluginMarketSource)) throw apiError("INVALID_ARGUMENT", "市场源无效");
  const custom = String(settings.pluginMarketCustomUrl ?? "").trim();
  if (custom) validateSource(custom);
  return { pluginMarketSource: settings.pluginMarketSource, pluginMarketCustomUrl: custom };
}
export function normalizeScope(scope) {
  if (!isObject(scope) || !["global", "projects"].includes(scope.mode) || !Array.isArray(scope.projects) || scope.projects.length > 200) throw apiError("INVALID_ARGUMENT", "插件生效范围无效");
  const projects = scope.projects.map((path) => {
    if (typeof path !== "string" || !/^(?:\/|[A-Za-z]:[\\/])/.test(path) || /[\x00-\x1f]/.test(path)) throw apiError("INVALID_ARGUMENT", "项目路径无效");
    return path.replace(/\\/g, "/").replace(/\/$/, "") || "/";
  });
  return { mode: scope.mode, projects: [...new Set(projects)] };
}
export function inScope(scope, workspace) {
  if (!scope || scope.mode === "global") return true;
  if (!workspace) return false;
  const normalize = (path) => path.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
  const path = normalize(workspace);
  return scope.projects.some((entry) => { const root = normalize(entry); return path === root || path.startsWith(root + "/"); });
}
export function validateSource(source) {
  let url; try { url = new URL(source); } catch { throw apiError("INVALID_ARGUMENT", "市场地址必须为有效 URL"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.hash || url.protocol !== "https:" && !(local && url.protocol === "http:")) throw apiError("INVALID_ARGUMENT", "市场地址需要 HTTPS；本机开发地址允许 HTTP");
  return url;
}
export async function readJson(path) {
  try {
    const meta = await lstat(path);
    if (meta.isSymbolicLink() || !meta.isFile() || meta.size > MAX_BYTES * 8) throw apiError("LIMIT_EXCEEDED", "插件元数据文件无效或过大");
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function writeJson(path, value) {
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`, bytes = JSON.stringify(value, null, 2);
  if (Buffer.byteLength(bytes) > MAX_BYTES * 8) throw apiError("LIMIT_EXCEEDED", "插件元数据超额");
  try { await writeFile(temp, bytes, { flag: "wx", mode: 0o600 }); await rename(temp, path); }
  finally { await rm(temp, { force: true }).catch(() => {}); }
}
