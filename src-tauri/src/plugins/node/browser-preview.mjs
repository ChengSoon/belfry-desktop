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
  constructor(workspace, reload) { this.workspace = workspace; this.reload = reload; this.token = randomBytes(24).toString("hex"); }
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
    const { full, meta } = await this.checked(join(this.root, path));
    if (meta.size > 50 * 1024 * 1024) throw apiError("LIMIT_EXCEEDED", "预览资源超过限制");
    response.writeHead(200, { "Content-Type": MIME[extname(full).toLowerCase()] ?? "application/octet-stream", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    const stream = createReadStream(full); stream.on("error", () => response.destroy()); stream.pipe(response);
  }
  async target(input) {
    const raw = String(input?.path ?? input?.url ?? "").trim();
    if (!raw || raw.length > 8192) throw apiError("INVALID_ARGUMENT", "浏览地址为空或过长");
    if (input?.path != null || await this.isLocal(raw)) return this.localTarget(raw);
    this.watcher?.close(); this.watcher = null;
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
    await this.start(); this.watch(file.full);
    return `${this.origin}/${this.token}/${file.relativePath.split(sep).map(encodeURIComponent).join("/")}`;
  }
  watch(path) {
    this.watcher?.close(); clearTimeout(this.timer);
    this.watcher = watch(dirname(path), () => { clearTimeout(this.timer); this.timer = setTimeout(() => void this.reload().catch(() => {}), 250); });
    this.watcher.on("error", () => this.watcher?.close());
  }
  async close() {
    this.watcher?.close(); clearTimeout(this.timer);
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise((resolveClose) => this.server.close(resolveClose));
  }
}
function externalTarget(raw) {
    let url; try { url = new URL(/^https?:/i.test(raw) ? raw : `http://${raw}`); } catch { throw apiError("INVALID_ARGUMENT", "浏览地址无效"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw apiError("PERMISSION_DENIED", "浏览器只允许 HTTP(S) 地址和工作区文件");
    return url.href;
}
