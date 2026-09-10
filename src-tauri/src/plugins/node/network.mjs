import { apiError, permission } from "./errors.mjs";

export const RESPONSE_LIMIT = 512 * 1024;
export function httpUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw apiError("INVALID_ARGUMENT", "URL 无效"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw apiError("PERMISSION_DENIED", "只允许无内嵌凭证的 HTTP(S) URL");
  return url;
}
export async function boundedBody(response, limit = RESPONSE_LIMIT) {
  const parts = []; let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.length;
    if (length > limit) throw apiError("LIMIT_EXCEEDED", "网络响应过大");
    parts.push(chunk);
  }
  return Buffer.concat(parts).toString("utf8");
}
export async function networkFetch(entry, input) {
  permission(entry, "net.fetch");
  const url = httpUrl(input?.url), domains = entry.manifest.net?.domains ?? [];
  const allowed = domains.some((domain) => domain.startsWith("*.") ? url.hostname.endsWith(domain.slice(1).toLowerCase()) : url.hostname === domain.toLowerCase());
  if (!allowed) throw apiError("PERMISSION_DENIED", "网络域名不在插件声明范围内");
  const headers = validateRequest(input);
  const timeout = Math.max(100, Math.min(30_000, Number(input.timeoutMs) || 15_000));
  const response = await fetch(url, { method: input.method ?? "GET", headers, body: input.body, redirect: "error",
    signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(timeout)]) });
  return { status: response.status, headers: Object.fromEntries(response.headers), bodyText: await boundedBody(response) };
}
function validateRequest(input) {
  if (input.body !== undefined && (typeof input.body !== "string" || Buffer.byteLength(input.body) > RESPONSE_LIMIT)) throw apiError("INVALID_ARGUMENT", "网络请求内容无效或超额");
  const headers = new Headers(input.headers ?? {});
  for (const name of headers.keys()) if (/^(?:host|connection|content-length|cookie|proxy-|sec-)/i.test(name)) throw apiError("PERMISSION_DENIED", "网络请求包含保留请求头");
  return headers;
}
