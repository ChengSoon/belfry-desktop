// Adapted from PI-Desktop host-core/plugins.rs, LGPL-3.0; see third_party/pi-desktop/NOTICE.md.
import { apiError } from "./errors.mjs";
import { validId, isObject } from "./manifest-values.mjs";
import { validateSource } from "./management.mjs";
export const BELFRY_SOURCE = "https://raw.githubusercontent.com/ChengSoon/belfry-desktop-plugins/main/catalog.json";
export const OFFICIAL_SOURCE = "https://raw.githubusercontent.com/vastsa/pi-desktop-plugins/main/catalog.json";
export const MIRROR_SOURCE = "https://cnb.cool/aixk/pi-desktop-plugins/-/git/raw/main/catalog.json";
export const PACKAGE_BYTES = 50 * 1024 * 1024;
const DISTRIBUTION_HOSTS = ["github.com", "githubusercontent.com", "cnb.cool"];

export function packageUrlAllowed(value, source) {
  const url = validateSource(value), origin = validateSource(source);
  const trusted = DISTRIBUTION_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith("." + host));
  if (!trusted && url.hostname !== origin.hostname) throw apiError("UNTRUSTED_HOST", `不允许从 ${url.hostname} 下载插件包`);
  return url.href;
}
export async function download(value, { source = value, maxBytes = PACKAGE_BYTES, resource = "package" } = {}) {
  let url = packageUrlAllowed(value, source);
  const signal = AbortSignal.timeout(25_000);
  for (let attempt = 0; attempt <= 5; ++attempt) {
    const response = await fetch(url, { redirect: "manual", signal, headers: { "User-Agent": "Belfry-PI-Plugin-Host" } });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location"); await response.body?.cancel();
      if (!location) throw apiError("NETWORK", "市场重定向缺少地址");
      url = packageUrlAllowed(new URL(location, url).href, source); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw downloadHttpError(response.status, url, resource); }
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) { await response.body?.cancel(); throw apiError("LIMIT_EXCEEDED", "市场响应超过大小限制"); }
    const chunks = []; let length = 0;
    for await (const chunk of response.body ?? []) {
      length += chunk.length;
      if (length > maxBytes) throw apiError("LIMIT_EXCEEDED", "市场响应超过大小限制");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw apiError("NETWORK", "市场重定向次数过多");
}
export function diagnosticUrl(value) {
  const url = new URL(value), limit = 1024;
  return `${url.origin}${url.pathname}`.slice(0, limit);
}
function downloadHttpError(status, url, resource) {
  const address = diagnosticUrl(url);
  if (status !== 404) return apiError("NETWORK", `${resource === "catalog" ? "市场目录" : "插件包"}请求失败：HTTP ${status}。地址：${address}`);
  if (resource !== "catalog") return apiError("PACKAGE_NOT_FOUND", `插件包不存在或尚未发布（HTTP 404），请刷新市场或联系插件作者。下载地址：${address}`);
  if (address === BELFRY_SOURCE) return apiError("MARKET_NOT_FOUND", `Belfry GitHub 插件中心尚未发布可访问的 catalog.json（HTTP 404）。请先使用「我的插件市场」，仓库公开并发布目录后再切换。市场地址：${address}`);
  return apiError("MARKET_NOT_FOUND", `未找到市场目录（HTTP 404）。请填写 catalog.json 的完整地址，并确认仓库、分支和文件已公开。市场地址：${address}`);
}
export function compareVersions(a, b) {
  const [left, preLeft] = versionParts(a), [right, preRight] = versionParts(b);
  const x = left.split(".").map(Number), y = right.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); ++i) { const order = (x[i] || 0) - (y[i] || 0); if (order) return order; }
  if (!preLeft && !preRight) return 0;
  if (!preLeft || !preRight) return preLeft ? -1 : 1;
  return comparePrerelease(preLeft.split("."), preRight.split("."));
}
function versionParts(value) {
  const version = String(value).replace(/^v/, "").split("+")[0], separator = version.indexOf("-");
  return separator < 0 ? [version, ""] : [version.slice(0, separator), version.slice(separator + 1)];
}
function comparePrerelease(p, q) {
  for (let i = 0; i < Math.max(p.length, q.length); ++i) {
    if (p[i] === q[i]) continue;
    if (p[i] === undefined || q[i] === undefined) return p[i] === undefined ? -1 : 1;
    return compareIdentifier(p[i], q[i]);
  }
  return 0;
}
function compareIdentifier(a, b) {
  const numbers = [a, b].map((part) => /^\d+$/.test(part));
  if (numbers.every(Boolean)) return BigInt(a) < BigInt(b) ? -1 : 1;
  if (numbers[0] !== numbers[1]) return numbers[0] ? -1 : 1;
  return a < b ? -1 : 1;
}
export function normalizeCatalog(raw, source) {
  if (!isObject(raw) || ![1, 2].includes(raw.schemaVersion) || !Array.isArray(raw.plugins) || raw.plugins.length > 2000) throw apiError("MARKET_INVALID", "市场目录格式无效");
  const seen = new Set(), official = [OFFICIAL_SOURCE, MIRROR_SOURCE].includes(source);
  const plugins = raw.plugins.map((entry) => {
    if (!isObject(entry) || !validId(entry.id) || seen.has(entry.id) || !Array.isArray(entry.versions)) throw apiError("MARKET_INVALID", "市场插件身份或版本列表无效");
    seen.add(entry.id);
    const versions = entry.versions.map((version) => normalizeVersion(version, raw, source)).sort((a, b) => compareVersions(b.version, a.version));
    return { ...entry, ...localizedFields(entry), ...trustFields(entry, official), versions };
  });
  return { ...raw, plugins };
}
function normalizeVersion(version, raw, source) {
  if (typeof version.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][\w.+-]+)?$/.test(version.version)) throw apiError("MARKET_INVALID", "市场版本无效");
  const base = raw.artifactBaseUrl ? new URL(raw.artifactBaseUrl.replace(/\/?$/, "/"), source) : source;
  const url = version.url ? new URL(version.url, base).href : "";
  return { ...version, url, permissions: Array.isArray(version.permissions) ? version.permissions : [] };
}
function localizedFields(entry) {
  const localized = entry.i18n?.["zh-CN"] ?? {};
  return Object.fromEntries(["name", "description", "safetyNotes", "readmeMarkdown"].map((field) => [field, localized[field] ?? entry[field]]));
}
function trustFields(entry, official) {
  const verified = official && (entry.trust === "verified" || entry.verified === true);
  return { verified, trust: verified ? "verified" : entry.trust === "unknown" ? "unknown" : "community" };
}
export function latestVersion(entry) { return entry.versions.find((version) => !version.yanked) ?? entry.versions[0]; }
export function installable(version) { return !!version?.url && /^[\da-f]{64}$/i.test(version?.shasum ?? "") && !version.yanked; }
export function summarize(entry, installed) {
  const latest = latestVersion(entry);
  return { id: entry.id, name: entry.name || entry.id, description: entry.description || "", author: entry.author || "",
    ...latestSummary(latest),
    categories: entry.categories ?? [], downloads: entry.downloads, trust: entry.trust, verified: entry.verified,
    publisherId: entry.publisherId, installed: !!installed, installedVersion: installed?.version,
    updateAvailable: updateAvailable(latest, installed),
    installable: installable(latest), yanked: !!entry.versions.length && entry.versions.every((version) => version.yanked) };
}
function latestSummary(latest) {
  return { latestVersion: latest?.version ?? "", permissionSummary: latest?.permissions ?? [], updatedAt: latest?.publishedAt ?? "" };
}
function updateAvailable(latest, installed) {
  return !!installed && !!latest && !latest.yanked && compareVersions(latest.version, installed.version) > 0;
}
