import { createServer } from "node:http";
import { createReadStream, watch } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { apiError } from "./errors.mjs";
import { cleanPath } from "./fs-policy.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2" };
export class BrowserPreview {
  constructor(workspace, reload) {
    this.workspace = workspace; this.reload = reload; this.token = randomBytes(24).toString("hex");
    this.resources = new Map();
  }
  async checked(path) {
    if (!this.root) this.root = await realpath(this.workspace);
    const outside = (value) => isAbsolute(value) || value === ".." || value.startsWith(`..${sep}`);
    if (outside(relative(resolve(this.workspace), path)) && outside(relative(this.root, path))) throw apiError("PERMISSION_DENIED", "只能预览当前会话工作区内的文件");
    const full = await realpath(path), location = relative(this.root, full), meta = await lstat(path);
    if (outside(location) || !meta.isFile() || meta.isSymbolicLink()) throw apiError("PERMISSION_DENIED", "预览文件链接越界或类型无效");
    cleanPath(location.split(sep).join("/"));
    return { full, meta, relativePath: location };
  }
  async start() {
    if (this.server) return;
    this.server = createServer((request, response) => this.receive(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(404); response.end("Not found");
    }));
    this.server.requestTimeout = 10_000; this.server.headersTimeout = 10_000;
    await new Promise((resolveStart, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolveStart); });
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
  }
  async receive(request, response) {
    if (request.method !== "GET" || request.headers.host !== this.origin.slice(7)) { response.writeHead(403); response.end(); return; }
    const pathname = new URL(request.url, this.origin).pathname, prefix = `/${this.token}/`;
    if (!pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    const path = decodeURIComponent(pathname.slice(prefix.length)); cleanPath(path);
    const watcher = this.watcher;
    const requested = join(this.root, path);
    const { full, meta } = await this.checked(requested).catch(error => {
      // A referenced asset can be created after the HTML, e.g. by a local build.
      if (error.code === "ENOENT" && watcher && watcher === this.watcher && !this.resources.has(requested)) {
        this.resources.set(requested, null);
      }
      throw error;
    });
    if (meta.size > 50 * 1024 * 1024) throw apiError("LIMIT_EXCEEDED", "预览资源超过限制");
    if (watcher && watcher === this.watcher && !this.resources.has(full)) this.resources.set(full, resourceStamp(meta));
    response.writeHead(200, { "Content-Type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    const stream = createReadStream(full); stream.on("error", () => response.destroy()); stream.pipe(response);
  }
  async target(input) {
    const raw = String(input?.path ?? input?.url ?? "").trim();
    if (!raw || raw.length > 8192) throw apiError("INVALID_ARGUMENT", "浏览地址为空或过长");
    if (input?.path != null || await this.isLocal(raw)) return this.localTarget(raw);
    this.stopWatching();
    return externalTarget(raw);
  }
  async isLocal(raw) {
    if (/^file:/i.test(raw) || isAbsolute(raw) || /^\.{1,2}\//.test(raw)) return true;
    if (!this.workspace || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) return false;
    return lstat(resolve(this.workspace, raw)).then((meta) => meta.isFile() || meta.isSymbolicLink(), () => false);
  }
  async localTarget(raw) {
    if (!this.workspace) throw apiError("NO_WORKSPACE", "请先打开项目再预览文件");
    const path = /^file:/i.test(raw) ? fileURLToPath(raw) : resolve(this.workspace, raw), file = await this.checked(path);
    await this.start(); this.watch(file);
    return `${this.origin}/${this.token}/${file.relativePath.split(sep).map(encodeURIComponent).join("/")}`;
  }
  watch(file) {
    this.stopWatching();
    this.resources.set(file.full, resourceStamp(file.meta));
    const watcher = watch(dirname(file.full), () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.reloadChanged(watcher).catch(() => {}), 250);
    });
    this.watcher = watcher;
    watcher.on("error", () => { if (this.watcher === watcher) this.stopWatching(); });
  }
  async reloadChanged(watcher) {
    // Windows can report directory/access notifications during file selection.
    // Reload only for a changed resource the page actually loaded, keeping form state intact.
    const checked = await Promise.all([...this.resources].map(async ([path, before]) => {
      const after = await this.checked(path).then(({ meta }) => resourceStamp(meta), () => null);
      return { path, before, after };
    }));
    if (this.watcher !== watcher) return;
    let changed = false;
    for (const { path, before, after } of checked) {
      if (this.resources.get(path) !== before || after === before) continue;
      this.resources.set(path, after); changed = true;
    }
    if (changed) await this.reload();
  }
  stopWatching() {
    this.watcher?.close(); this.watcher = null; clearTimeout(this.timer); this.resources.clear();
  }
  async close() {
    this.stopWatching();
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise((resolveClose) => this.server.close(resolveClose));
  }
}
function resourceStamp(meta) { return meta.isFile() ? `${meta.ino}:${meta.size}:${meta.mtimeMs}` : null; }
function externalTarget(raw) {
    let url; try { url = new URL(/^https?:/i.test(raw) ? raw : `http://${raw}`); } catch { throw apiError("INVALID_ARGUMENT", "浏览地址无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw apiError("PERMISSION_DENIED", "浏览器只允许 HTTP(S) 地址和工作区文件");
    return url.href;
}
