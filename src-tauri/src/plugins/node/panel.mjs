import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { extname } from "node:path";
import { apiError, errorValue, permission } from "./errors.mjs";
import { resourcePath } from "./manifest.mjs";
import { BRIDGE_SOURCE, bridgeArguments } from "./panel-bridge.mjs";
import { panelHtml } from "./panel-html.mjs";

const MAX_BODY = 1024 * 1024;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp" };
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors tauri://localhost http://tauri.localhost https://tauri.localhost http://127.0.0.1:1420";
function localized(value, locale, fallback) {
  return typeof value === "string" ? value : value?.[locale] ?? value?.en ?? value?.["zh-CN"] ?? fallback;
}
async function body(request) {
  let bytes = 0, parts = [];
  for await (const part of request) {
    bytes += part.length;
    if (bytes > MAX_BODY) throw apiError("LIMIT_EXCEEDED", "面板请求超额");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
function validOrigin(request, origin) {
  return request.headers.host === origin.slice(7) && (!request.headers.origin || request.headers.origin === origin);
}
function customChannel(api) {
  return typeof api === "string" && !!api && api.length <= 128 && !/^(?:plugins|author|management|market|desktop|surface)\./.test(api);
}
export class PanelServer {
  constructor({ entry, files, call, custom }) {
    this.entry = entry; this.files = files; this.call = call; this.custom = custom; this.streams = new Map();
    this.token = randomBytes(32).toString("hex");
    this.server = createServer((request, response) => this.receive(request, response).catch((error) => {
      if (!response.headersSent) response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: errorValue(error) }));
    }));
    this.server.requestTimeout = 10_000; this.server.headersTimeout = 10_000;
  }
  async start() {
    await new Promise((resolve, reject) => { this.server.once("error", reject); this.server.listen(0, "127.0.0.1", resolve); });
    this.origin = `http://127.0.0.1:${this.server.address().port}`;
    this.base = `${this.origin}/p/${this.token}/`;
    return this;
  }
  surface(viewId, context, options = {}) {
    const manifest = this.entry.manifest;
    const descriptor = viewId ? manifest.contributes?.views?.find((item) => item.id === viewId) : manifest.ui;
    permission(this.entry, viewId ? "ui.view" : "ui.panel");
    if (!descriptor) throw apiError("NOT_FOUND", "插件未声明此面板/视图");
    const path = resourcePath(viewId ? descriptor.entry : descriptor.panel);
    return { url: this.base + path.split("/").map(encodeURIComponent).join("/") + `?piSurface=${viewId ? "view" : "panel"}${viewId ? `&piViewId=${encodeURIComponent(viewId)}` : ""}`, viewId,
      title: localized(options.title ?? descriptor.title, context.locale, manifest.name),
      width: Math.max(320, Math.min(1600, Number(descriptor.width) || 640)), height: Math.max(240, Math.min(1200, Number(descriptor.height) || 480)) };
  }
  async receive(request, response) {
    response.setHeader("Cache-Control", "no-store"); response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff"); response.setHeader("Content-Security-Policy", CSP);
    if (this.entry.stopping || !validOrigin(request, this.origin)) {
      response.writeHead(403); response.end(); return;
    }
    const url = new URL(request.url, this.origin), prefix = `/p/${this.token}/`;
    if (!url.pathname.startsWith(prefix)) { response.writeHead(404); response.end(); return; }
    const path = decodeURIComponent(url.pathname.slice(prefix.length));
    if (path === "__invoke") return this.invoke(request, response);
    if (request.method !== "GET") { response.writeHead(405); response.end(); return; }
    if (path === "__events") return this.subscribe(request, response, url.searchParams.get("surfaceId") ?? "panel");
    return this.asset(path, response);
  }
  asset(path, response) {
    if (path === "__bridge.js") { response.writeHead(200, { "Content-Type": MIME[".js"] }); response.end(BRIDGE_SOURCE); return; }
    const bytes = this.files.get(resourcePath(path));
    if (!bytes) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "Content-Type": MIME[extname(path)] ?? "application/octet-stream" });
    response.end(extname(path) === ".html" ? this.html(bytes) : bytes);
  }
  html(bytes) {
    return panelHtml(bytes, `${this.base}__bridge.js`);
  }
  async invoke(request, response) {
    if (request.method !== "POST" || request.headers.origin !== this.origin || !request.headers["content-type"]?.startsWith("application/json")) {
      response.writeHead(403); response.end(); return;
    }
    const { api, payload } = await body(request);
    let args;
    try { args = bridgeArguments(api, payload); } catch (error) {
      if (!customChannel(api)) throw error;
    }
    const value = args ? await this.call(api, args) : await this.custom(api, payload);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, value: value ?? null }));
  }
  subscribe(request, response, surfaceId) {
    if (this.streams.size >= 8) { response.writeHead(429); response.end(); return; }
    response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
    response.write(": connected\n\n"); this.streams.set(response, surfaceId);
    request.on("close", () => this.streams.delete(response));
  }
  emit(name, args, surfaceId) {
    for (const [stream, target] of this.streams) if ((!surfaceId || target === surfaceId) && stream.writableLength < 2 * MAX_BODY) stream.write(`data: ${JSON.stringify({ name, args })}\n\n`);
  }
  async close() {
    for (const stream of this.streams.keys()) stream.end(); this.streams.clear();
    this.server.closeAllConnections();
    if (this.server.listening) await new Promise((resolve) => this.server.close(resolve));
  }
}
