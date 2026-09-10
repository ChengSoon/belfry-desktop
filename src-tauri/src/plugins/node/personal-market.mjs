import { lstat, readFile, readdir, realpath, mkdir, mkdtemp, rename, rmdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { readDirectory } from "./directory.mjs";
import { storeZip } from "./zip.mjs";
import { readJson, writeJson } from "./management.mjs";
import { compareVersions, PACKAGE_BYTES } from "./market-catalog.mjs";
import { marketSite } from "./market-site.mjs";
import { apiError } from "./errors.mjs";
import { directoryAt, inside, marketLock } from "./market-storage.mjs";

export const PERSONAL_SOURCE = "belfry-market://personal/catalog.json";
const EMPTY_CATALOG = { schemaVersion: 2, providerId: "personal", name: "我的插件市场", plugins: [] };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export class PersonalMarket {
  constructor(root) { this.root = resolve(root); }
  async catalog() {
    await directoryAt(this.root);
    const value = await readJson(join(this.root, "catalog.json")) ?? structuredClone(EMPTY_CATALOG);
    if (value.schemaVersion !== 2 || !Array.isArray(value.plugins)) throw apiError("MARKET_INVALID", "我的市场目录格式无效，原文件已保留");
    return value;
  }
  async info() {
    const catalog = await this.catalog();
    return { directory: this.root, name: catalog.name, pluginCount: catalog.plugins.length,
      versionCount: catalog.plugins.reduce((count, plugin) => count + plugin.versions.length, 0) };
  }
  async configure({ name }) {
    if (typeof name !== "string" || !name.trim() || name.length > 100) throw apiError("INVALID_ARGUMENT", "市场名称需要 1–100 个字符");
    return this.lock(async () => {
      const catalog = await this.catalog(); catalog.name = name.trim();
      await writeJson(join(this.root, "catalog.json"), catalog);
      return this.info();
    });
  }
  lock(operation) { return marketLock(this.root, operation); }
  async publish({ directory, changelog = "", expectedDigest }) {
    const snapshot = await readDirectory(directory);
    if (expectedDigest && snapshot.digest !== expectedDigest) throw apiError("PLUGIN_CHANGED", "插件内容已变化，请重新预览后发布");
    if (typeof changelog !== "string" || changelog.length > 16_384) throw apiError("INVALID_ARGUMENT", "更新说明过长");
    return this.lock(() => this.publishSnapshot(snapshot, changelog));
  }
  async publishSnapshot(snapshot, changelog) {
    const { manifest, files } = snapshot, catalog = await this.catalog();
    const bytes = storeZip(files), sha256 = digest(bytes);
    if (bytes.length > PACKAGE_BYTES) throw apiError("LIMIT_EXCEEDED", "插件包超过 50 MiB，请减少资源后发布");
    const previous = catalog.plugins.find((plugin) => plugin.id === manifest.id);
    const existing = previous?.versions.find((version) => version.version === manifest.version);
    if (existing && existing.shasum !== sha256) throw apiError("VERSION_EXISTS", "这个版本已经发布，请提升插件版本后重试");
    if (existing) {
      if (digest(await this.readPackage(existing.url)) !== sha256) throw apiError("INTEGRITY", "已发布的插件包被修改，请检查市场目录");
      return { id: manifest.id, version: manifest.version, sha256, directory: this.root, unchanged: true };
    }
    const fileName = `${manifest.id}-${manifest.version}-${sha256.slice(0, 16)}.piplug`;
    await directoryAt(join(this.root, "packages"));
    const path = join(this.root, "packages", fileName);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 }).catch(async (error) => {
      if (error.code !== "EEXIST") throw error;
      if (digest(await this.readPackage(`packages/${fileName}`)) !== sha256) throw apiError("INTEGRITY", "发布目录中的同名插件包内容不一致");
    });
    const entry = marketEntry(snapshot, previous, { url: `packages/${fileName}`, shasum: sha256, sizeBytes: bytes.length, changelog });
    catalog.plugins = [...catalog.plugins.filter((plugin) => plugin.id !== manifest.id), entry].sort((a, b) => a.name.localeCompare(b.name));
    await writeJson(join(this.root, "catalog.json"), catalog);
    return { id: manifest.id, name: manifest.name, version: manifest.version, sha256, packagePath: path, directory: this.root };
  }
  async readPackage(url) {
    const source = new URL(url, PERSONAL_SOURCE);
    if (source.protocol !== "belfry-market:" || source.host !== "personal" || source.search || source.hash
      || !/^packages\/[a-zA-Z0-9._+-]+\.piplug$/.test(url.replace(PERSONAL_SOURCE.replace("catalog.json", ""), ""))) {
      throw apiError("INVALID_ARGUMENT", "本地市场插件包路径无效");
    }
    const directory = await directoryAt(join(this.root, "packages")), path = join(directory, source.pathname.slice("/packages/".length));
    const meta = await lstat(path);
    if (!meta.isFile() || meta.isSymbolicLink() || meta.size > PACKAGE_BYTES) throw apiError("INVALID_ARGUMENT", "本地市场插件包文件无效或超额");
    const bytes = await readFile(path);
    if (bytes.length > PACKAGE_BYTES) throw apiError("LIMIT_EXCEEDED", "插件包超过大小限制");
    return bytes;
  }
  async export(destination) {
    const target = resolve(destination), root = await directoryAt(this.root);
    if (inside(this.root, target) || inside(root, target)) throw apiError("INVALID_ARGUMENT", "请在市场目录之外选择空目录");
    const parent = await realpath(dirname(target));
    const output = join(parent, basename(target));
    if (inside(root, output)) throw apiError("INVALID_ARGUMENT", "请在市场目录之外选择空目录");
    const existing = await emptyDestination(output);
    const catalog = await this.catalog();
    const stage = await mkdtemp(join(parent, ".belfry-market-export-"));
    try {
      await this.exportFiles(stage, catalog);
      if (existing) await rmdir(output);
      try { await rename(stage, output); }
      catch (error) {
        if (existing) await mkdir(output).catch((reason) => { if (reason.code !== "EEXIST") throw reason; });
        throw error;
      }
    } finally { await rm(stage, { recursive: true, force: true }); }
    return { directory: output, pluginCount: catalog.plugins.length };
  }
  async exportFiles(output, catalog) {
    await directoryAt(join(output, "packages"));
    for (const plugin of catalog.plugins) for (const version of plugin.versions) {
      const bytes = await this.readPackage(version.url);
      if (digest(bytes) !== version.shasum) throw apiError("INTEGRITY", "市场包摘要不一致，未导出目录索引");
      await writeFile(join(output, version.url), bytes, { flag: "wx" });
    }
    await writeJson(join(output, "catalog.json"), catalog);
    await writeFile(join(output, "index.html"), marketSite(), { flag: "wx" });
    await writeFile(join(output, ".nojekyll"), "", { flag: "wx" });
    await writeFile(join(output, "README.txt"), "将本目录整体部署到任意静态网站（如自有服务器或 GitHub Pages）。\n在 Belfry 的插件市场来源中选择“自有在线市场”，填写网站的 catalog.json 地址。\n无需构建、数据库或账号服务；勿单独移动 catalog.json 与 packages。\n本机预览：python3 -m http.server 8080\n", { flag: "wx" });
  }
}
async function emptyDestination(output) {
  const existing = await lstat(output).catch((error) => { if (error.code !== "ENOENT") throw error; });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(output)).length)) throw apiError("INVALID_ARGUMENT", "导出目标必须为空目录");
  return existing;
}

function marketEntry({ manifest, files }, previous, artifact) {
  const version = { ...artifact, version: manifest.version, permissions: manifest.permissions ?? [], fs: manifest.fs, net: manifest.net,
    publishedAt: new Date().toISOString(), provenance: "local-author" };
  const versions = [...(previous?.versions ?? []), version].sort((a, b) => compareVersions(b.version, a.version));
  return { id: manifest.id, name: manifest.name, description: manifest.description ?? "", author: manifest.author ?? "",
    categories: manifest.categories ?? [], homepage: manifest.homepage, repository: manifest.repository,
    safetyNotes: manifest.safetyNotes, i18n: manifest.i18n, trust: "community", versions,
    readmeMarkdown: files.get("README.md")?.toString("utf8") ?? previous?.readmeMarkdown ?? "" };
}
