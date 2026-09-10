// Adapted from PI-Desktop host-core/plugins.rs, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { mkdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { apiError } from "./errors.mjs";
import { readJson, writeJson } from "./management.mjs";
import { BELFRY_SOURCE, OFFICIAL_SOURCE, MIRROR_SOURCE, diagnosticUrl, download, normalizeCatalog, summarize, latestVersion, installable, compareVersions } from "./market-catalog.mjs";
import { PersonalMarket, PERSONAL_SOURCE } from "./personal-market.mjs";
import { PI_API_VERSION, matchesVersionRange } from "./engine-version.mjs";

export class PluginMarket {
  constructor({ base, management, installed }) {
    this.base = base; this.management = management; this.installed = installed; this.catalogs = new Map();
    this.personal = new PersonalMarket(join(base, "market", "personal"));
  }
  source(settings = this.management.snapshot().settings) {
    if (settings.pluginMarketSource === "personal") return PERSONAL_SOURCE;
    if (settings.pluginMarketSource === "belfry") return BELFRY_SOURCE;
    return settings.pluginMarketSource === "custom" ? settings.pluginMarketCustomUrl : settings.pluginMarketSource === "mirror" ? MIRROR_SOURCE : OFFICIAL_SOURCE;
  }
  cachePath(source) { return join(this.base, "market", `${createHash("sha256").update(source).digest("hex")}.json`); }
  async cached(source = this.source()) {
    if (source === PERSONAL_SOURCE) return normalizeCatalog(await this.personal.catalog(), source);
    if (this.catalogs.has(source)) return this.catalogs.get(source);
    const cached = await readJson(this.cachePath(source));
    if (cached?.sourceUrl === source && cached.catalog) { this.catalogs.set(source, cached.catalog); return cached.catalog; }
    return null;
  }
  async refresh(sourceUrl = this.source()) {
    if (!sourceUrl) throw apiError("INVALID_ARGUMENT", "请填写市场目录地址");
    if (sourceUrl === PERSONAL_SOURCE) return { sourceUrl, ...(await this.personal.info()) };
    const bytes = await download(sourceUrl, { maxBytes: 8 * 1024 * 1024, resource: "catalog" });
    const catalog = parseCatalog(bytes, sourceUrl);
    await writeJson(this.cachePath(sourceUrl), { sourceUrl, fetchedAt: Date.now(), catalog });
    this.catalogs.set(sourceUrl, catalog);
    return { sourceUrl, pluginCount: catalog.plugins.length, providerId: catalog.providerId, homepage: catalog.homepage };
  }
  async search({ query = "", category = "" } = {}) {
    const source = this.source(), catalog = await this.cached(source), needle = String(query).trim().toLocaleLowerCase();
    const plugins = (catalog?.plugins ?? []).filter((entry) => {
      const text = `${entry.id} ${entry.name} ${entry.description} ${entry.author}`.toLocaleLowerCase();
      return (!needle || text.includes(needle)) && (!category || entry.categories?.includes(category));
    }).map((entry) => summarize(entry, this.installed().find((plugin) => plugin.id === entry.id)));
    plugins.sort((a, b) => a.name.localeCompare(b.name));
    return { plugins, sourceUrl: source, cached: !!catalog };
  }
  async detail(id, source = this.source()) {
    const entry = (await this.cached(source))?.plugins.find((entry) => entry.id === id);
    if (!entry) throw apiError("NOT_FOUND", "市场中没有此插件，请刷新市场");
    const summary = summarize(entry, this.installed().find((plugin) => plugin.id === id));
    return { ...summary, versions: entry.versions, permissions: summary.permissionSummary, readmeMarkdown: entry.readmeMarkdown,
      homepage: entry.homepage, repository: entry.repository, safetyNotes: entry.safetyNotes, screenshots: entry.screenshots ?? [] };
  }
  async prepare(input) {
    const source = this.source();
    try { await this.refresh(source); } catch (error) { if (!await this.cached(source)) throw error; }
    const detail = await this.detail(input.id, source);
    const version = detail.versions.find((entry) => entry.version === (input.version ?? detail.latestVersion));
    validateInstallVersion(version);
    const bytes = source === PERSONAL_SOURCE ? await this.personal.readPackage(version.url) : await download(version.url, { source });
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== version.shasum.toLowerCase()) throw apiError("INTEGRITY", "插件包 SHA-256 摘要不匹配");
    const directory = join(this.base, "cache", "downloads"); await mkdir(directory, { recursive: true });
    const path = join(directory, `${randomUUID()}.piplug`);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    return { path, id: detail.id, version: version.version, permissions: version.permissions, minPiDesktop: version.minPiDesktop,
      marketplace: { providerId: source, shasum: hash, publisherId: detail.publisherId, trust: detail.trust, provenance: version.provenance } };
  }
  async updates(refreshRemote = true) {
    if (refreshRemote) { try { await this.refresh(); } catch (error) { if (!await this.cached()) throw error; } }
    const catalog = await this.cached();
    return this.installed().flatMap((plugin) => {
      const entry = catalog?.plugins.find((item) => item.id === plugin.id), latest = entry && latestVersion(entry);
      if (!latest || latest.yanked || compareVersions(latest.version, plugin.version) <= 0) return [];
      const permissionDiff = latest.permissions.filter((permission) => !plugin.permissions.includes(permission));
      const policyChanged = !isDeepStrictEqual(plugin.fs ?? {}, latest.fs ?? {}) || !isDeepStrictEqual(plugin.net ?? {}, latest.net ?? {});
      return [{ id: plugin.id, version: latest.version, permissionDiff, policyChanged, installable: installable(latest), enabled: plugin.enabled }];
    });
  }
  async updatePlan() {
    const updates = [], skipped = [];
    for (const item of await this.updates(false)) {
      const preference = this.management.preference(item.id);
      if (!preference.autoUpdate) continue;
      const sourceChanged = preference.marketplace?.providerId && preference.marketplace.providerId !== this.source();
      if (!item.installable || item.policyChanged || item.permissionDiff.length || sourceChanged) skipped.push(item.id);
      else updates.push(item);
    }
    return { updates, skipped };
  }
}
function parseCatalog(bytes, source) {
  let raw;
  try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw apiError("MARKET_INVALID", `市场地址未返回有效的 JSON 目录，请使用 catalog.json 的完整地址。市场地址：${diagnosticUrl(source)}`); }
  return normalizeCatalog(raw, source);
}
function validateInstallVersion(version) {
  if (!version) throw apiError("NOT_FOUND", "插件版本不存在");
  if (version.yanked) throw apiError("MARKET_YANKED", `插件版本已撤回：${version.yankedReason ?? version.version}`);
  if (!installable(version)) throw apiError("MARKET_INVALID", "这个版本尚未发布插件包");
  if (!version.minPiDesktop) return;
  if (!hostVersionMatches(version.minPiDesktop)) throw apiError("INCOMPATIBLE", `插件需要 PI API ${version.minPiDesktop}，当前兼容版本为 ${PI_API_VERSION}`);
}
// 上游目录里 minPiDesktop 既写范围（">=0.8.0"）也写裸版本号，后者按下限处理。
function hostVersionMatches(declared) {
  const value = String(declared).trim(), range = /^[<>=^~]/.test(value) ? value : `>=${value}`;
  try { return matchesVersionRange(range, "minPiDesktop"); }
  catch { throw apiError("MARKET_INVALID", `插件声明的宿主版本要求无效：${declared}`); }
}
